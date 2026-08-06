import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TicketMessagesRepository } from './ticket-messages.repository';
import { TicketMessage, TicketMessageVisibility } from './entities/ticket-message.entity';
import { TicketsRepository } from '../tickets/tickets.repository';
import { TicketEventsService } from '../tickets/ticket-events.service';
import { SlaService } from '../tickets/sla.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketEvent } from '../tickets/entities/ticket-event.entity';
import { TicketActor, resolveActorIds } from '../tickets/domain/ticket-actor';
import { TicketStatus, assertTransition } from '../tickets/domain/ticket-state-machine';

/**
 * Identificador tal y como puede llegar del código que lo leyó: TypeORM hidrata
 * **toda** columna `bigint` como cadena aunque la entidad la declare `number`.
 * Se acepta como venga y no se compara nunca contra un número con `===`; para
 * escribir se usa siempre el `id` del ticket ya cargado, que es el mismo valor
 * que la propia base devolvió.
 */
type Id = number | string;

export interface PostMessageInput {
  bodyMd: string;
  /** Solo la respeta un autor del equipo. Ver `post`. */
  visibility?: TicketMessageVisibility;
}

export interface PostedMessage {
  message: TicketMessage;
  /** El ticket tal y como queda: ya reactivado, si el mensaje lo reactivó. */
  ticket: Ticket;
}

/** Estado en el que el reloj de SLA está parado esperando al cliente. */
const WAITING_STATUS: TicketStatus = 'ESPERA_CLIENTE';
/** A donde vuelve el ticket cuando el cliente responde. */
const RESUMED_STATUS: TicketStatus = 'EN_ATENCION';

/**
 * Escribe el hilo de un ticket. Es el único camino por el que se guarda un
 * mensaje, y por lo tanto el único sitio donde se sostienen sus tres
 * invariantes: quién es el autor, qué visibilidad tiene y si el mensaje
 * reactiva el ticket.
 */
@Injectable()
export class TicketMessagesService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly messages: TicketMessagesRepository,
    private readonly events: TicketEventsService,
    private readonly sla: SlaService,
  ) {}

  /**
   * Guarda un mensaje del hilo y, si el mensaje es la respuesta que el equipo
   * estaba esperando, reactiva el ticket.
   *
   * **Visibilidad.** Un actor de cliente escribe siempre `PUBLICA`, se pida lo
   * que se pida. `CreatePortalMessageDto` ni siquiera declara el campo, pero
   * eso solo cubre el camino que hoy usa ese DTO: si mañana un controlador
   * eligiera el otro, o llegara un `visibility` por cualquier otra vía, una
   * nota interna acabaría visible en el portal -- una fuga que no se puede
   * retirar. Así que se ignora aquí también, y se decide con el mismo reparto
   * del actor que puebla las columnas de autor, no con una segunda lectura de
   * `actor.kind` que pudiera divergir de aquella.
   *
   * **Reactivación.** Cliente + público + ticket en `ESPERA_CLIENTE` devuelve
   * el ticket a `EN_ATENCION`. El reloj no se recalcula: `SlaService.applyPause`
   * **desplaza** los vencimientos por lo que duró la pausa, que es lo mismo que
   * hace `TicketTransitionsService` al salir de ese estado. Recalcularlos desde
   * cero le quitaría al cliente todo el tiempo que estuvo esperando y el SLA
   * mentiría. El tipo del evento sale de `TicketEventsService.typeForTransition`,
   * el mismo mapeo que usa el timeline para cualquier otra transición.
   *
   * **Una sola transacción** para el mensaje, su evento y el cambio de estado:
   * un mensaje guardado con el ticket todavía en «Espera cliente» es
   * exactamente el ticket dormido con la respuesta dentro que este hilo viene a
   * evitar. Como en `TicketsService.create` y en
   * `TicketTransitionsService.transition`, dentro del callback se escribe con
   * `manager.getRepository(...)` y nunca con los repositorios o servicios
   * inyectados: esos usan su propia conexión y no participarían del
   * commit/rollback.
   */
  async post(actor: TicketActor, ticketId: Id, input: PostMessageInput): Promise<PostedMessage> {
    // Lo primero, y fuera de la transacción: sin autor no se escribe nada.
    const author = resolveActorIds(actor, 'del mensaje');

    const bodyMd = input.bodyMd?.trim();
    if (!bodyMd) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'El mensaje no puede estar vacío.',
      });
    }

    // Quien tiene `clientUserId` es el portal, y el portal nunca escribe notas
    // internas. Se deriva del mismo reparto que las columnas de autor para que
    // no haya dos maneras distintas de contestar «¿esto lo escribe un cliente?».
    const esCliente = author.clientUserId !== null;
    const visibility: TicketMessageVisibility = esCliente
      ? 'PUBLICA'
      : (input.visibility ?? 'PUBLICA');

    const ticket = await this.tickets.findById(ticketId as number);
    if (!ticket) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    }

    // Un ticket cerrado no admite mensajes: su hilo es evidencia cerrada, y
    // `CERRADO` no tiene ninguna transición de salida (ver el mapa de
    // `ticket-state-machine.ts`), así que un mensaje ahí no puede despertar a
    // nadie -- quedaría escrito donde ya no lo lee ningún flujo de trabajo.
    // Para seguir hablando de un ticket cerrado se reabre uno nuevo. Los demás
    // estados sí admiten mensajes, `RESUELTO` incluido: es justo donde el
    // cliente dice «sigue fallando».
    if (ticket.status === 'CERRADO') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Un ticket cerrado no admite mensajes nuevos.',
      });
    }

    const from = ticket.status;
    const reactiva = esCliente && visibility === 'PUBLICA' && from === WAITING_STATUS;

    // Todo lo que decide el parche se calcula antes de abrir la transacción:
    // `applyPause` y `typeForTransition` son cálculo puro, no tocan la base.
    let patch: Partial<Ticket> | null = null;
    if (reactiva) {
      assertTransition(from, RESUMED_STATUS);
      const resumed = this.sla.applyPause(ticket, new Date());
      patch = {
        status: RESUMED_STATUS,
        pausedAt: resumed.pausedAt,
        pausedTotalSeconds: resumed.pausedTotalSeconds,
        slaResponseDueAt: resumed.slaResponseDueAt,
        slaResolutionDueAt: resumed.slaResolutionDueAt,
      };
      // `first_response_at` no se toca a propósito: es la primera respuesta
      // **del equipo**, y quien escribe aquí es el cliente. (Un ticket solo
      // llega a ESPERA_CLIENTE pasando antes por EN_ATENCION, así que ya la
      // tiene puesta; ponerla aquí solo podría falsearla.)
    }

    return this.tickets.runInTransaction(async (manager) => {
      const messageRepo = manager.getRepository(TicketMessage);
      const eventRepo = manager.getRepository(TicketEvent);

      const message = await messageRepo.save(
        messageRepo.create({
          ticketId: ticket.id,
          bodyMd,
          visibility,
          authorUserId: author.userId,
          authorClientUserId: author.clientUserId,
        }),
      );

      // El cuerpo no se copia al evento: el timeline es visible para más ojos
      // que el hilo, y duplicar ahí una nota interna la filtraría por la puerta
      // de al lado. Solo el id y la visibilidad, que es lo que hace falta para
      // saber qué pasó sin saber qué decía.
      await eventRepo.save(
        eventRepo.create({
          ticketId: ticket.id,
          type: 'MESSAGE_POSTED',
          actorUserId: author.userId,
          actorClientUserId: author.clientUserId,
          fromStatus: null,
          toStatus: null,
          reason: null,
          payload: { messageId: message.id, visibility },
        }),
      );

      if (!patch) return { message, ticket };

      const ticketRepo = manager.getRepository(Ticket);
      await ticketRepo.update(ticket.id, patch);

      await eventRepo.save(
        eventRepo.create({
          ticketId: ticket.id,
          type: this.events.typeForTransition(from, RESUMED_STATUS),
          actorUserId: author.userId,
          actorClientUserId: author.clientUserId,
          fromStatus: from,
          toStatus: RESUMED_STATUS,
          reason: null,
          payload: { messageId: message.id, automatica: true },
        }),
      );

      return { message, ticket: (await ticketRepo.findOneBy({ id: ticket.id }))! };
    });
  }

  /**
   * El hilo tal y como lo puede ver quien pregunta. El filtro lo resuelve el
   * repositorio en el `WHERE`, nunca en memoria.
   *
   * Quién ve las notas internas se decide aquí, no en el controlador: es la
   * misma política que fuerza `PUBLICA` al escribir, y tenerla en dos capas
   * distintas es cómo se actualiza una y se olvida la otra. Un `kind` no
   * contemplado no lee nada -- `resolveActorIds` falla cerrado.
   */
  async listThread(actor: TicketActor, ticketId: Id): Promise<TicketMessage[]> {
    const ids = resolveActorIds(actor, 'de la petición');
    return this.messages.listByTicket(ticketId, { includeInternal: ids.clientUserId === null });
  }
}
