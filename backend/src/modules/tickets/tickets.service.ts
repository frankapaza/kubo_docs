import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import { TicketsRepository, TicketListFilters } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { SlaService } from './sla.service';
import { ClientsService } from '../clients/clients.service';
import { ProjectsService } from '../projects/projects.service';

import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { derivePriority } from './domain/ticket-priority';
import { OPEN_STATUSES } from './domain/ticket-state-machine';

export interface DecoratedTicket extends Ticket {
  slaLabel: string;
  slaPct: number | null;
  slaOverdue: boolean;
}

/**
 * Quién origina la escritura: un miembro del equipo o un usuario del portal
 * de clientes. Las dos columnas del actor en Ticket/TicketEvent nunca se
 * ponen a la vez -- decidido por `kind` -- para que la fila nunca quede en
 * un estado ambiguo sobre quién la creó.
 */
export type TicketActor =
  | { kind: 'STAFF'; userId: number }
  | { kind: 'CLIENT'; clientUserId: number };

/** Las dos columnas del actor, ya repartidas. Nunca van las dos a la vez. */
interface ActorColumns {
  createdBy: number | null;
  createdByClientUserId: number | null;
}

/**
 * Reparte el actor en sus dos columnas, o se niega a escribir.
 *
 * Con los ternarios `actor.kind === 'STAFF' ? … : null` repartidos por dos
 * sitios, un tercer valor de `kind` producía un ticket **y** su evento CREATED
 * con las dos columnas nulas: un ticket sin autor, posible solo desde que la
 * 013 hizo `created_by` nullable, y que ya no se puede atribuir a nadie a
 * posteriori. La invariante la sostenía únicamente la unión de TypeScript, que
 * no existe en tiempo de ejecución: basta un `as any`, un JSON deserializado o
 * una variante nueva sin actualizar aquí.
 *
 * El `never` deja además el descuido en tiempo de compilación: añadir un
 * tercer `kind` a `TicketActor` sin decidir sus columnas no compila.
 */
function resolveActorColumns(actor: TicketActor): ActorColumns {
  switch (actor.kind) {
    case 'STAFF':
      return { createdBy: actor.userId, createdByClientUserId: null };
    case 'CLIENT':
      return { createdBy: null, createdByClientUserId: actor.clientUserId };
    default: {
      const noContemplado: never = actor;
      throw new InternalServerErrorException({
        code: 'INTERNAL',
        message:
          'No se pudo determinar el autor del ticket: tipo de actor no contemplado ' +
          `(${JSON.stringify((noContemplado as { kind?: unknown })?.kind)}).`,
      });
    }
  }
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

  async create(actor: TicketActor, dto: CreateTicketDto): Promise<Ticket> {
    // Lo primero: sin autor no se escribe nada, ni ticket ni evento.
    const actorColumns = resolveActorColumns(actor);

    if (dto.clientId) await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId) await this.projects.findById(dto.projectId);

    const createdAt = new Date();
    const priority = derivePriority(dto.impact ?? null, dto.urgency ?? null);
    const slaInit = await this.sla.initForTicket({
      clientId: dto.clientId ?? null,
      createdAt,
      priority,
    });

    // El alta, la asignación del código y el evento CREATED tienen que
    // confirmarse juntos: si el código o el evento fallaran fuera de una
    // transacción, el ticket quedaría sin código o sin timeline, rompiendo
    // el invariante de "exactamente un evento CREATED" que asume el detalle.
    return this.repo.runInTransaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const eventRepo = manager.getRepository(TicketEvent);

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

      return (await ticketRepo.findOneBy({ id: ticket.id }))!;
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
