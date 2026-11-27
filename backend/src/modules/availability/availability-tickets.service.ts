import { Injectable } from '@nestjs/common';
import { TicketAssignmentService } from '../tickets/ticket-assignment.service';
import { TicketEventsService } from '../tickets/ticket-events.service';
import { TicketTransitionsService } from '../tickets/ticket-transitions.service';
import { canTransition } from '../tickets/domain/ticket-state-machine';
import {
  TicketPriority,
  TicketUrgency,
} from '../tickets/domain/ticket-priority';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketsRepository } from '../tickets/tickets.repository';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service';
import { MONITORING_ACTOR_EMAIL } from './availability.constants';
import type { Criticality } from './core';
import { buildIncidentTicket } from './domain/ticket-text';
import { MonitorIncident } from './entities/monitor-incident.entity';

export interface IncidentTicketContext {
  clientId: number;
  systemId: number | null;
  criticality: Criticality;
  serviceNames: string[];
  serverName: string;
  /** Diagnóstico real; si falta se usa un texto genérico. */
  diagnosis?: string;
}

const URGENCY: Record<Criticality, TicketUrgency> = {
  HIGH: 'ALTA',
  MEDIUM: 'MEDIA',
  LOW: 'BAJA',
};
const PRIORITY: Record<Criticality, TicketPriority> = {
  HIGH: 'P1',
  MEDIUM: 'P2',
  LOW: 'P3',
};
const RANK: Record<TicketPriority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

const REOPEN_REASON =
  'El servicio volvió a caer antes de 30 minutos de recuperado.';
const RAISE_REASON = 'Se sumó un servicio más crítico al incidente de servidor';

const labelOf = (incidentId: number) => `monitoreo:incidente:${incidentId}`;

/** Tickets automáticos de caídas: siempre internos (origen MONITOREO), firmados por el usuario de monitoreo. */
@Injectable()
export class AvailabilityTicketsService {
  private monitoringUserId: number | null = null;

  constructor(
    private readonly tickets: TicketsService,
    private readonly transitions: TicketTransitionsService,
    private readonly events: TicketEventsService,
    private readonly assignment: TicketAssignmentService,
    private readonly repo: TicketsRepository,
    private readonly users: UsersService,
  ) {}

  /** Se resuelve una vez, en el primer uso (así el arranque y las pruebas ajenas no dependen de ello). */
  private async actorId(): Promise<number> {
    if (this.monitoringUserId === null) {
      const user = await this.users.findByEmail(MONITORING_ACTOR_EMAIL);
      if (!user)
        throw new Error(
          'Falta el usuario de monitoreo: aplicar la migración 035',
        );
      this.monitoringUserId = Number(user.id);
    }
    return this.monitoringUserId;
  }

  async ensureTicket(
    incident: MonitorIncident,
    ctx: IncidentTicketContext,
  ): Promise<Ticket> {
    const existing = await this.repo.findByLabel(labelOf(incident.id));
    if (existing) {
      // Cura el UPDATE no transaccional de la creación si se cayó a medias.
      if (!existing.escalationLevel) {
        await this.repo.update(Number(existing.id), { escalationLevel: 'N1' });
      }
      return existing;
    }
    return this.createTicket(incident, ctx, null);
  }

  private async createTicket(
    incident: MonitorIncident,
    ctx: IncidentTicketContext,
    previousCode: string | null,
  ): Promise<Ticket> {
    const userId = await this.actorId();
    const text = buildIncidentTicket({
      kind: incident.kind === 'ROUTE' ? 'ROUTE' : 'DOWN',
      serviceNames: ctx.serviceNames,
      serverName: ctx.serverName,
      firstFailureAt: incident.firstFailureAt,
      confirmedAt: incident.confirmedAt,
      diagnosis:
        ctx.diagnosis ??
        (incident.kind === 'ROUTE'
          ? 'El servicio responde desde otros puntos pero no desde Perú.'
          : 'El servicio no responde a las comprobaciones.'),
    });
    const rawText = previousCode
      ? `Continúa el incidente del ticket ${previousCode}.\n\n${text.rawText}`
      : text.rawText;
    // Mismo camino que logs (ErrorActionsService): el servicio puede elegir
    // MONITOREO aunque el DTO HTTP lo prohíba. Nunca se asigna.
    // nadie elige el sistema; decisión 13 del diseño de disponibilidad
    const created = await this.tickets.create(
      { kind: 'STAFF', userId },
      {
        rawText,
        subject: text.subject,
        origin: 'MONITOREO',
        requestType: 'INCIDENCIA',
        serviceCategory: 'SOPORTE',
        impact: 'ALTO',
        urgency: URGENCY[ctx.criticality],
        clientId: ctx.clientId,
        systemId: ctx.systemId ?? undefined,
        labels: ['monitoreo', 'disponibilidad', labelOf(incident.id)],
      },
      undefined,
      'EXENTO_SIN_QUIEN_ELIJA',
    );
    // No transaccional: si falla, el ticket queda sin nivel N1 (inofensivo).
    await this.repo.update(Number(created.id), { escalationLevel: 'N1' });
    return created;
  }

  /** Solo sube la prioridad del ticket, nunca la baja. */
  async raisePriority(
    ticketId: number,
    criticality: Criticality,
  ): Promise<void> {
    const ticket = await this.repo.findById(ticketId);
    if (!ticket) return;
    if (RANK[PRIORITY[criticality]] >= RANK[ticket.priority]) return;
    await this.assignment.overridePriority({
      ticketId,
      actorUserId: await this.actorId(),
      impact: 'ALTO',
      urgency: URGENCY[criticality],
      reason: RAISE_REASON,
    });
  }

  async reopenOrReplace(
    incident: MonitorIncident,
    ticketId: number,
    ctx: IncidentTicketContext,
  ): Promise<Ticket> {
    const ticket = await this.repo.findById(ticketId);
    if (!ticket) return this.replace(incident, ctx, ticketId, null);
    const previousCode = ticket.code ?? `#${ticket.id}`;
    if (ticket.status === 'CERRADO')
      return this.replace(incident, ctx, ticketId, previousCode);
    if (ticket.status === 'RESUELTO') {
      if (!canTransition(ticket.status, 'EN_ATENCION'))
        return this.replace(incident, ctx, ticketId, previousCode);
      return this.transitions.transition({
        ticketId,
        actorUserId: await this.actorId(),
        toStatus: 'EN_ATENCION',
        reason: REOPEN_REASON,
      });
    }
    await this.comment(ticketId, REOPEN_REASON, { incidentId: incident.id });
    return ticket;
  }

  /** Idempotente: si un intento previo ya creó el reemplazo (y no se llegó a guardar ticket_id), se reutiliza. */
  private async replace(
    incident: MonitorIncident,
    ctx: IncidentTicketContext,
    oldTicketId: number,
    previousCode: string | null,
  ): Promise<Ticket> {
    const found = await this.repo.findByLabel(labelOf(incident.id));
    if (
      found &&
      Number(found.id) !== Number(oldTicketId) &&
      found.status !== 'CERRADO'
    )
      return found;
    return this.createTicket(incident, ctx, previousCode);
  }

  async comment(
    ticketId: number,
    text: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.events.record({
      ticketId,
      type: 'COMMENT',
      actorUserId: await this.actorId(),
      reason: text,
      payload: { source: 'DISPONIBILIDAD', ...payload },
    });
  }
}
