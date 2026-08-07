import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { TicketsRepository, TicketListFilters } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { SlaService } from './sla.service';
import { ClientsService } from '../clients/clients.service';
import { ProjectsService } from '../projects/projects.service';

import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import {
  TicketMessage,
  TicketMessageVisibility,
} from '../ticket-messages/entities/ticket-message.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { derivePriority } from './domain/ticket-priority';
import { OPEN_STATUSES } from './domain/ticket-state-machine';
import { TicketActor, resolveActorIds } from './domain/ticket-actor';

/**
 * Reexportado desde aquí porque es donde vivía antes de que el hilo de mensajes
 * necesitara el mismo actor; la definición y su reparto están en
 * `domain/ticket-actor.ts`.
 */
export type { TicketActor } from './domain/ticket-actor';

export interface DecoratedTicket extends Ticket {
  slaLabel: string;
  slaPct: number | null;
  slaOverdue: boolean;
}

/**
 * El ticket recién creado, con el identificador de su primer mensaje.
 *
 * Va aquí y no en una segunda consulta porque los adjuntos del alta se suben
 * **después** de crear el ticket y contra ese mensaje (`POST
 * /tickets/:id/messages/:messageId/attachments`): sin este dato, la pantalla de
 * subida tendría que adivinar de cuál de los mensajes del hilo colgarlos.
 *
 * Es `number` y no `number | null`: el alta escribe **siempre** su primer
 * mensaje. Un identificador que a veces faltara devolvería a quien sube la
 * pregunta «¿y si este ticket no tiene mensaje?», y contestarla con un adjunto
 * suelto es exactamente la fila sin visibilidad heredada que `upload` dejó de
 * admitir.
 *
 * Extiende `Ticket` --como `DecoratedTicket`-- en vez de envolverlo en
 * `{ ticket, firstMessageId }` para no cambiarle la forma a la respuesta de
 * `POST /tickets`, que hoy es el ticket tal cual y así la consume el panel.
 */
export interface CreatedTicket extends Ticket {
  firstMessageId: number;
}

/** Las dos columnas del actor, ya repartidas. Nunca van las dos a la vez. */
interface ActorColumns {
  createdBy: number | null;
  createdByClientUserId: number | null;
}

/**
 * Las columnas de autor del ticket, a partir del reparto compartido de
 * `domain/ticket-actor.ts` -- el mismo que usa el hilo de mensajes para sus
 * columnas hermanas `author_user_id` / `author_client_user_id`. Aquí solo se
 * les pone el nombre que tienen en `tickets`: el `switch` con su `never` vive
 * en un único sitio, porque duplicarlo es duplicar el descuido que impide.
 */
function resolveActorColumns(actor: TicketActor): ActorColumns {
  const ids = resolveActorIds(actor, 'del ticket');
  return { createdBy: ids.userId, createdByClientUserId: ids.clientUserId };
}

/**
 * Con qué visibilidad nace el primer mensaje del hilo, según **quién abre el
 * ticket**. Lo decide el `kind` del actor -- el hecho -- y nunca la ausencia de
 * un `createdByClientUserId` ni un `origin === 'PORTAL'`, que son consecuencias
 * suyas y pueden divergir: un ticket marcado PORTAL pero abierto por el equipo
 * cumpliría la segunda condición sin cumplir la que importa.
 *
 * **Del portal, `PUBLICA`.** Lo escribió el cliente y tiene que seguir
 * viéndolo: es el motivo entero de que el alta escriba un mensaje. Que ese
 * texto se duplique con `raw_text` es **deliberado** -- ver `firstMessageBody`.
 *
 * **Del panel, `INTERNA`.** Y esta es la mitad que no se puede relajar.
 * `raw_text` en un alta del equipo es la captura en crudo: el WhatsApp pegado,
 * la transcripción sin revisar de una llamada, lo que el técnico anotó mientras
 * le contaban el problema. Hoy el cliente **no** ve nada de eso -- el portal
 * solo publica `raw_text` cuando lo escribió él mismo, ver
 * `PortalTicketsService.visibleDescription` --, así que publicarlo ahora como
 * primer mensaje sería abrir por el hilo la puerta que la descripción tiene
 * cerrada. Y con los adjuntos del alta detrás: el volcado de logs que un
 * técnico arrastra al crear el ticket es literalmente el archivo por el que
 * `upload` pasó a exigir `messageId`. El equipo que quiera decirle algo al
 * cliente tiene el compositor del hilo, con sus dos botones y su confirmación.
 */
function firstMessageVisibility(actor: TicketActor): TicketMessageVisibility {
  return actor.kind === 'CLIENT' ? 'PUBLICA' : 'INTERNA';
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly events: TicketEventsService,
    private readonly sla: SlaService,
    private readonly clients: ClientsService,
    private readonly projects: ProjectsService,
  ) {}

  async findByIdOrFail(id: number): Promise<Ticket> {
    const t = await this.repo.findById(id);
    if (!t) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    }
    return t;
  }

  async list(filters: TicketListFilters): Promise<DecoratedTicket[]> {
    const now = new Date();
    const rows = await this.repo.list(filters);
    return rows.map((t) => this.decorate(t, now));
  }

  async findWithTimeline(id: number): Promise<{ ticket: DecoratedTicket; timeline: TicketEvent[] }> {
    const ticket = await this.findByIdOrFail(id);
    const timeline = await this.events.listByTicket(id);
    return { ticket: this.decorate(ticket, new Date()), timeline };
  }

  /**
   * Campos derivados del reloj de SLA. Se calculan en el servidor para que la
   * bandeja y el detalle muestren lo mismo sin duplicar la lógica en el cliente.
   */
  decorate(ticket: Ticket, now: Date): DecoratedTicket {
    const consumed = this.sla.consumed(ticket, now);
    return Object.assign({}, ticket, {
      slaLabel: this.sla.remainingLabel(ticket, now),
      slaPct: consumed === null ? null : Math.min(100, Math.round(consumed * 100)),
      slaOverdue:
        consumed !== null && consumed >= 1 && OPEN_STATUSES.includes(ticket.status),
    }) as DecoratedTicket;
  }

  /**
   * Da de alta un ticket **y el primer mensaje de su hilo**.
   *
   * ## Por qué el alta escribe un mensaje
   *
   * Para que **todo adjunto cuelgue de un mensaje**, sin excepciones. Un adjunto
   * suelto no hereda ninguna visibilidad y acababa publicándose al cliente
   * pasara lo que pasara (ver `TicketAttachmentsService.upload` y
   * `TicketMessagesRepository.listAttachments`); por eso `upload` exige
   * `messageId`. Los archivos que se aportan al crear el ticket necesitan
   * entonces un mensaje del que colgar, y ese mensaje es este.
   *
   * ## La duplicación con `raw_text` es deliberada. No la "arregles".
   *
   * El cuerpo del primer mensaje repite el texto que va a `raw_text`, y así debe
   * seguir. **Son dos cosas distintas que hoy coinciden:**
   *
   * - El **hilo** es el registro de lo que se dijo. No se reescribe nunca:
   *   quien lo lea dentro de un año tiene que ver las palabras exactas con las
   *   que se abrió el ticket.
   * - La **descripción** (`description_md`, y `raw_text` como respaldo) es el
   *   resumen de trabajo, y el triaje con IA la reescribe (`TicketAIService`).
   *
   * Que diverjan no es un fallo, es la razón de ser de las dos: el cliente tiene
   * que seguir viendo en su hilo lo que él escribió aunque la IA lo reformule
   * para el equipo. Unificarlas -- hacer que el mensaje lea de `raw_text`, o que
   * el alta no escriba mensaje y el hilo "empiece" por la descripción -- le
   * cambiaría al cliente, a posteriori, un texto que él firmó.
   *
   * ## Un hecho, un evento
   *
   * No se escribe ningún `MESSAGE_POSTED`. El alta ya tiene su evento --
   * `CREATED` --, y de él ya cuelgan los dos avisos que corresponden: el acuse
   * al cliente y el «ticket nuevo por el portal» al equipo (`plansForEvent`). Un
   * `MESSAGE_POSTED` además le mandaría al equipo un segundo correo
   * (`TICKET_MESSAGE_FROM_CLIENT`) por el mismo hecho y en el mismo segundo, y
   * un correo no se retira. El mensaje viaja con el alta, no aparte.
   */
  async create(actor: TicketActor, dto: CreateTicketDto): Promise<CreatedTicket> {
    // Lo primero: sin autor no se escribe nada, ni ticket, ni evento, ni mensaje.
    const actorColumns = resolveActorColumns(actor);
    const visibility = firstMessageVisibility(actor);

    if (dto.clientId) await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId) await this.projects.findById(dto.projectId);

    const createdAt = new Date();
    const priority = derivePriority(dto.impact ?? null, dto.urgency ?? null);
    const slaInit = await this.sla.initForTicket({
      clientId: dto.clientId ?? null,
      createdAt,
      priority,
    });

    // El alta, la asignación del código, el evento CREATED y el primer mensaje
    // tienen que confirmarse juntos: si el código o el evento fallaran fuera de
    // una transacción, el ticket quedaría sin código o sin timeline, rompiendo
    // el invariante de "exactamente un evento CREATED" que asume el detalle. Y
    // un ticket sin su primer mensaje --o un mensaje sin su ticket-- es un
    // estado que no debe existir: la pantalla de subida cuelga los adjuntos del
    // alta de ese identificador, así que un ticket que naciera sin él dejaría
    // los archivos sin destino y sin forma de recuperarlos.
    //
    // Todo se escribe con `manager.getRepository(...)` y **nunca** con los
    // repositorios o servicios inyectados: esos usan su propia conexión y no
    // participarían del commit/rollback. Por eso el mensaje no se delega en
    // `TicketMessagesService.post`, que además escribiría el `MESSAGE_POSTED`
    // que aquí no debe existir.
    return this.repo.runInTransaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const eventRepo = manager.getRepository(TicketEvent);
      const messageRepo = manager.getRepository(TicketMessage);

      const ticket = await ticketRepo.save(
        ticketRepo.create({
          clientId: dto.clientId ?? null,
          projectId: dto.projectId ?? null,
          systemId: dto.systemId ?? null,
          meetingId: dto.meetingId ?? null,
          origin: dto.origin ?? 'NOTE',
          requestType: dto.requestType ?? null,
          serviceCategory: dto.serviceCategory ?? null,
          subject: dto.subject?.trim() || null,
          rawText: dto.rawText.trim(),
          rawAudioFilename: dto.rawAudioFilename ?? null,
          labels: dto.labels ?? null,
          impact: dto.impact ?? null,
          urgency: dto.urgency ?? null,
          priority,
          status: 'NUEVO',
          capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : createdAt,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          durationMinutes: dto.durationMinutes ?? null,
          slaPolicyId: slaInit.slaPolicyId,
          slaResponseDueAt: slaInit.slaResponseDueAt,
          slaResolutionDueAt: slaInit.slaResolutionDueAt,
          createdBy: actorColumns.createdBy,
          createdByClientUserId: actorColumns.createdByClientUserId,
        }),
      );

      // El código legible depende del id autoincremental, así que se asigna después.
      await ticketRepo.update(ticket.id, { code: this.buildCode(ticket.id) });

      await eventRepo.save(
        eventRepo.create({
          ticketId: ticket.id,
          type: 'CREATED',
          // Las mismas columnas que el ticket: un solo reparto para los dos.
          actorUserId: actorColumns.createdBy,
          actorClientUserId: actorColumns.createdByClientUserId,
          fromStatus: null,
          toStatus: 'NUEVO',
          reason: null,
          payload: { origin: ticket.origin, priority: ticket.priority },
        }),
      );

      // El primer mensaje del hilo. Las columnas de autor salen del **mismo**
      // reparto que las del ticket y las del evento: `resolveActorIds`, una sola
      // vez, arriba. Un ticket que el equipo abrió por teléfono no tiene autor
      // de cliente, y su mensaje lo refleja igual que lo refleja el ticket --
      // `authorClientUserId` nulo -- porque las dos columnas vienen del mismo
      // sitio y no de dos lecturas del `kind` que pudieran divergir.
      const message = await messageRepo.save(
        messageRepo.create({
          ticketId: ticket.id,
          bodyMd: ticket.rawText,
          visibility,
          authorUserId: actorColumns.createdBy,
          authorClientUserId: actorColumns.createdByClientUserId,
        }),
      );

      const fresh = (await ticketRepo.findOneBy({ id: ticket.id }))!;
      return Object.assign({}, fresh, { firstMessageId: message.id }) as CreatedTicket;
    });
  }

  private buildCode(id: number): string {
    return `KB-${String(id).padStart(4, '0')}`;
  }

  async update(id: number, dto: UpdateTicketDto): Promise<Ticket> {
    const current = await this.findByIdOrFail(id);
    if (current.status === 'CERRADO') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Un ticket cerrado no admite modificaciones.',
      });
    }

    // No hay FK en la tabla: sin esta validación, un id inexistente se
    // guardaría igual y el ticket fallaría con 404 en cascada más adelante,
    // cuando algo intente resolver su cliente o proyecto.
    if (dto.clientId !== undefined) await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId !== undefined) await this.projects.findById(dto.projectId);

    const patch: Partial<Ticket> = { ...dto } as Partial<Ticket>;
    if (dto.capturedAt) patch.capturedAt = new Date(dto.capturedAt);
    if (dto.scheduledAt) patch.scheduledAt = new Date(dto.scheduledAt);

    // impact/urgency (y por lo tanto priority) no están en UpdateTicketDto:
    // solo se mueven por POST /tickets/:id/priority, que además deja rastro
    // en el timeline (PRIORITY_OVERRIDDEN). Ver docblock de UpdateTicketDto.

    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    const t = await this.findByIdOrFail(id);
    if (t.status !== 'NUEVO' && t.status !== 'TRIAJE') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Solo se puede borrar un ticket que aún no fue asignado. Ciérralo en su lugar.',
      });
    }
    await this.repo.remove(id);
  }
}
