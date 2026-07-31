import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

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

  async create(userId: number, dto: CreateTicketDto): Promise<Ticket> {
    if (dto.clientId) await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId) await this.projects.findById(dto.projectId);

    const createdAt = new Date();
    const priority = derivePriority(dto.impact ?? null, dto.urgency ?? null);
    const slaInit = await this.sla.initForTicket({
      clientId: dto.clientId ?? null,
      createdAt,
      priority,
    });

    const ticket = await this.repo.create({
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
      createdBy: userId,
    });

    // El código legible depende del id autoincremental, así que se asigna después.
    const withCode = await this.repo.update(ticket.id, { code: this.buildCode(ticket.id) });

    await this.events.record({
      ticketId: ticket.id,
      type: 'CREATED',
      actorUserId: userId,
      toStatus: 'NUEVO',
      payload: { origin: ticket.origin, priority: ticket.priority },
    });

    return withCode!;
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

    const patch: Partial<Ticket> = { ...dto } as Partial<Ticket>;
    if (dto.capturedAt) patch.capturedAt = new Date(dto.capturedAt);
    if (dto.scheduledAt) patch.scheduledAt = new Date(dto.scheduledAt);

    // Cambiar impacto o urgencia recalcula la prioridad, salvo override manual.
    const touchesMatrix = dto.impact !== undefined || dto.urgency !== undefined;
    if (touchesMatrix && current.priorityOverridden === 0) {
      patch.priority = derivePriority(
        (dto.impact ?? current.impact) ?? null,
        (dto.urgency ?? current.urgency) ?? null,
      );
    }

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
