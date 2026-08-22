import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { TicketMessagesRepository } from './ticket-messages.repository';
import { TicketMessage, TicketMessageVisibility } from './entities/ticket-message.entity';
import { Id, TicketMessageActor, loadVisibleTicketOrFail, resolveScope } from './actor-scope';
import { TicketsRepository } from '../tickets/tickets.repository';
import { TicketEventsService } from '../tickets/ticket-events.service';
import { SlaService } from '../tickets/sla.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketEvent } from '../tickets/entities/ticket-event.entity';
import { TicketStatus, assertTransition } from '../tickets/domain/ticket-state-machine';

/**
 * El actor, su ámbito y la carga del ticket visible viven en `./actor-scope`:
 * los comparte con `TicketAttachmentsService`, porque un adjunto y un mensaje
 * se acotan con la misma regla y dos copias de una regla de pertenencia son dos
 * reglas. Se reexporta el tipo del actor para no romper a quien ya lo importaba
 * de aquí.
 */
export type { TicketMessageActor } from './actor-scope';

export interface PostMessageInput {
  bodyMd: string;
  /** Solo la respeta un autor del equipo. Ver `post`. */
  visibility?: TicketMessageVisibility;
  /**
   * El cuerpo sin recortar, cuando el mensaje viene de un correo entrante
   * (`InboundEmailService`). `undefined`/ausente en cualquier mensaje escrito
   * desde el panel o el portal -- ahí no hay cita que recortar, y forzar aquí
   * un valor sería inventar un dato que nadie mandó.
   */
  bodyFull?: string;
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
    // Lo primero, y fuera de la transacción: sin autor ni ámbito no se escribe nada.
    const { ids: author, scope } = resolveScope(actor, 'del mensaje');

    const bodyMd = input.bodyMd?.trim();
    if (!bodyMd) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'El mensaje no puede estar vacío.',
      });
    }

    // Quien actúa acotado a una empresa es el portal, y el portal nunca escribe
    // notas internas.
    //
    // Sale de `scope.restricted` --es decir, del `kind` del actor-- y **no** de
    // `author.clientUserId !== null`, que era la versión anterior: esa se
    // apagaba sola cuando le faltaba el dato. Un actor de cliente sin
    // `clientUserId` (que `assertClientScope` no mira, porque solo comprueba el
    // `clientId`) pasaba por «no es cliente» y podía escribir una nota interna
    // desde el portal -- una fuga que no se puede retirar. Un guardia que se
    // desactiva justo cuando le falta su dato no es un guardia; por eso
    // `ClientScope` es una unión discriminada y no un valor que pueda faltar.
    const esCliente = scope.restricted;
    const visibility: TicketMessageVisibility = esCliente
      ? 'PUBLICA'
      : (input.visibility ?? 'PUBLICA');

    const ticket = await loadVisibleTicketOrFail(this.tickets, ticketId, scope);

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
          bodyFull: input.bodyFull ?? null,
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
   * El hilo tal y como lo puede ver quien pregunta. El filtro de visibilidad lo
   * resuelve el repositorio en el `WHERE`, nunca en memoria.
   *
   * Las dos mitades de "qué puede ver" se deciden aquí, no en el controlador:
   * **de quién es el ticket** (un ticket de otra empresa da 404, igual que al
   * escribir) y **qué visibilidad se lee** (un actor de cliente nunca pide las
   * notas internas). Es la misma política que al escribir, y tenerla repartida
   * en dos capas es cómo se actualiza una y se olvida la otra. Un `kind` no
   * contemplado no lee nada -- `resolveActorIds` falla cerrado.
   *
   * El interruptor es `!scope.restricted`, o sea el `kind` del actor, y **no**
   * `ids.clientUserId === null`, que era la versión anterior: un actor de
   * cliente sin `clientUserId` --dato que `assertClientScope` no comprueba--
   * salía con las notas internas incluidas. Mismo motivo que en `post`.
   */
  async listThread(actor: TicketMessageActor, ticketId: Id): Promise<TicketMessage[]> {
    const { scope } = resolveScope(actor, 'de la petición');
    const ticket = await loadVisibleTicketOrFail(this.tickets, ticketId, scope);
    return this.messages.listByTicket(ticket.id, { includeInternal: !scope.restricted });
  }

  /**
   * Enlaza un mensaje ya guardado con el correo entrante del que salió
   * (Task 8, `InboundEmailService.safeAttachInboundEmail`). Pasa tal cual a
   * `TicketMessagesRepository.attachInboundEmail` -- ver su comentario para el
   * porqué del orden de escrituras --; esta capa existe solo porque
   * `TicketMessagesRepository` **no se exporta** de este módulo a propósito
   * ("la única puerta al hilo es el servicio", ver `TicketMessagesModule`), y
   * la ingesta de correo es el único consumidor de fuera de este módulo que
   * necesita este enlace informativo.
   *
   * **Deliberadamente sin actor ni ámbito, a diferencia de `post`/`listThread`.**
   * No es un descuido: la razón por la que `TicketMessagesRepository` no se
   * exporta es precisamente que este servicio es quien impone la
   * autorización sobre el hilo (de quién es el ticket, qué visibilidad
   * puede leer o escribir cada actor) -- y ese control ya se aplicó **antes**
   * de llegar aquí. `messageId` es el id de un mensaje que `post` ya validó,
   * autorizó y escribió en esta misma pasada de `InboundEmailService.processOne`;
   * este método no decide nada sobre el hilo, solo rellena a posteriori una
   * columna puramente informativa (`ticket_messages.inbound_email_id`) sobre
   * una fila que ya existe y ya pasó ese control. Repetir aquí la resolución
   * de ámbito no protegería nada -- no hay ninguna pertenencia que comprobar
   * en un `UPDATE` de una sola columna sobre un id ya autorizado -- y sí
   * obligaría a inventar un actor synthetic para un enlace que no es una
   * acción del actor, es un efecto secundario de haber escrito el mensaje.
   */
  attachInboundEmail(messageId: Id, inboundEmailId: number): Promise<void> {
    return this.messages.attachInboundEmail(messageId, inboundEmailId);
  }
}
