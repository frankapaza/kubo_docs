import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TicketMessagesRepository } from './ticket-messages.repository';
import { TicketMessage, TicketMessageVisibility } from './entities/ticket-message.entity';
import { sameId } from '../../common/ids';
import { TicketsRepository } from '../tickets/tickets.repository';
import { TicketEventsService } from '../tickets/ticket-events.service';
import { SlaService } from '../tickets/sla.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketEvent } from '../tickets/entities/ticket-event.entity';
import { ActorIds, TicketActor, resolveActorIds } from '../tickets/domain/ticket-actor';
import { TicketStatus, assertTransition } from '../tickets/domain/ticket-state-machine';

/**
 * Identificador tal y como puede llegar del código que lo leyó: TypeORM hidrata
 * **toda** columna `bigint` como cadena aunque la entidad la declare `number`.
 * Se acepta como venga y no se compara nunca contra un número con `===`; para
 * escribir se usa siempre el `id` del ticket ya cargado, que es el mismo valor
 * que la propia base devolvió, y para comparar, `sameId`.
 */
type Id = number | string;

/**
 * El actor del hilo. Igual que `TicketActor`, pero el de cliente **tiene que
 * traer también su `clientId`**.
 *
 * No es un adorno: es lo único que separa a una empresa de otra. Sin él, un
 * usuario del portal podría escribir en el hilo de cualquier `ticketId` y leer
 * los mensajes públicos del ticket de otra empresa a base de probar números.
 * En el portal sale del token igual que el `clientUserId` (ver
 * `ClientJwtStrategy` y `portal-tickets.controller.ts`), nunca del cuerpo, la
 * URL ni la query.
 *
 * Se deriva de `TicketActor` en vez de redeclararse para que añadir mañana un
 * tercer `kind` allí obligue a decidir aquí también.
 */
export type TicketMessageActor =
  | Extract<TicketActor, { kind: 'STAFF' }>
  | (Extract<TicketActor, { kind: 'CLIENT' }> & { clientId: number });

/** El actor ya resuelto: sus columnas de autor y a qué empresa se limita. */
interface ActorScope {
  ids: ActorIds;
  /** `clientId` al que queda acotado, o `null` si es del equipo y lo ve todo. */
  clientScope: number | null;
}

/**
 * Reparte el actor y calcula su ámbito, o se niega a seguir.
 *
 * `resolveActorIds` es quien falla cerrado ante un `kind` no contemplado -- el
 * mismo guardia `never` que usa el alta del ticket -- así que a partir de ahí
 * el ternario es seguro y no necesita repetir el `switch`.
 */
function resolveScope(actor: TicketMessageActor, sujeto: string): ActorScope {
  const ids = resolveActorIds(actor, sujeto);
  return { ids, clientScope: actor.kind === 'CLIENT' ? actor.clientId : null };
}

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
   * **Pertenencia.** Un actor de cliente solo escribe en los tickets de su
   * empresa; lo ajeno y lo inexistente dan el **mismo** 404. Se comprueba aquí
   * y no en el controlador por el mismo motivo que la visibilidad: un
   * controlador que lo olvide deja escribir en el hilo de otra empresa, y esa
   * es la mitad que de verdad las separa.
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
  async post(
    actor: TicketMessageActor,
    ticketId: Id,
    input: PostMessageInput,
  ): Promise<PostedMessage> {
    // Lo primero, y fuera de la transacción: sin autor no se escribe nada.
    const { ids: author, clientScope } = resolveScope(actor, 'del mensaje');

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

    const ticket = await this.loadVisibleOrFail(ticketId, clientScope);

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

      // El `UPDATE` va condicionado al estado que se leyó fuera de la
      // transacción, y se comprueba que afectó a una fila.
      //
      // Sin esa condición, dos mensajes simultáneos del mismo cliente -- el
      // doble clic en el portal, que es el escenario realista -- desplazarían
      // los vencimientos **dos veces** y escribirían dos cambios de estado. Y
      // hay un caso peor: si el equipo resuelve el ticket dentro de esa
      // ventana, el mensaje en vuelo lo devolvería a EN_ATENCION con
      // `resolved_at` ya puesto, es decir, una reapertura sin motivo que por el
      // camino normal `requiresReason` sí impide.
      //
      // Si no afectó a nadie, el ticket ya no está donde creíamos: el mensaje
      // se queda escrito -- es lo que el cliente mandó, y perderlo sería peor --
      // pero no se reactiva ni se escribe el evento de una transición que no ha
      // ocurrido.
      const movido = await ticketRepo.update({ id: ticket.id, status: from }, patch);
      if (!movido.affected) {
        return { message, ticket: (await ticketRepo.findOneBy({ id: ticket.id }))! };
      }

      await eventRepo.save(
        eventRepo.create({
          ticketId: ticket.id,
          type: this.events.typeForTransition(from, RESUMED_STATUS),
          actorUserId: author.userId,
          actorClientUserId: author.clientUserId,
          fromStatus: from,
          toStatus: RESUMED_STATUS,
          reason: null,
          payload: { messageId: message.id, automatic: true },
        }),
      );

      return { message, ticket: (await ticketRepo.findOneBy({ id: ticket.id }))! };
    });
  }

  /**
   * El ticket que quien pregunta puede ver, o 404.
   *
   * Un ticket de otra empresa y un ticket inexistente dan el **mismo** error y
   * el mismo cuerpo: un 403 confirmaría que el id existe y dejaría enumerar los
   * tickets de las demás empresas a base de probar números. Es la misma regla,
   * y la misma comparación `sameId`, que usa `PortalTicketsService.detail`.
   *
   * `sameId` compara **por valor** porque TypeORM devuelve los `bigint` como
   * cadena: con `===`, el `clientId` del token -- un número de verdad -- nunca
   * igualaría al de la base y el dueño legítimo se comería un 404. Y falla
   * cerrado por el otro lado: un ticket sin cliente (`clientId` nulo) o una
   * sesión sin `clientId` utilizable dan `false`, es decir, 404.
   */
  private async loadVisibleOrFail(ticketId: Id, clientScope: number | null): Promise<Ticket> {
    const ticket = await this.tickets.findById(ticketId as number);
    if (!ticket || (clientScope !== null && !sameId(ticket.clientId, clientScope))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    }
    return ticket;
  }

  /**
   * El hilo tal y como lo puede ver quien pregunta. El filtro de visibilidad lo
   * resuelve el repositorio en el `WHERE`, nunca en memoria.
   *
   * Las dos mitades de "qué puede ver" se deciden aquí, no en el controlador:
   * **de quién es el ticket** (un ticket de otra empresa da 404, igual que al
   * escribir) y **qué visibilidad se lee** (un actor de cliente nunca pide las
   * notas internas). Es la misma política que al escribir, y tenerla repartida
   * en dos capas es cómo se actualiza una y se olvida la otra. Un `kind` no
   * contemplado no lee nada -- `resolveActorIds` falla cerrado.
   */
  async listThread(actor: TicketMessageActor, ticketId: Id): Promise<TicketMessage[]> {
    const { ids, clientScope } = resolveScope(actor, 'de la petición');
    const ticket = await this.loadVisibleOrFail(ticketId, clientScope);
    return this.messages.listByTicket(ticket.id, { includeInternal: ids.clientUserId === null });
  }
}
