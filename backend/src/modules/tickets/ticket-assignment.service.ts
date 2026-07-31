import { Injectable, NotFoundException } from '@nestjs/common';

import { TicketsRepository } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { TicketTransitionsService } from './ticket-transitions.service';
import { SupportAgentsRepository } from './support-agents.repository';

import { Ticket, AgentLevel } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { SupportAgent } from './entities/support-agent.entity';
import {
  TicketImpact,
  TicketUrgency,
  TicketPriority,
  derivePriority,
} from './domain/ticket-priority';

@Injectable()
export class TicketAssignmentService {
  constructor(
    private readonly repo: TicketsRepository,
    // No se llama directamente: assign() y overridePriority() escriben su
    // evento con el EntityManager de su propia transacción (ver comentario
    // ahí), no con este servicio, que usa su propia conexión y no
    // participaría del commit/rollback. Se mantiene inyectado porque forma
    // parte del contrato de dependencias del módulo (§ Interfaces).
    private readonly events: TicketEventsService,
    private readonly transitions: TicketTransitionsService,
    private readonly agents: SupportAgentsRepository,
  ) {}

  private async findOrFail(id: number): Promise<Ticket> {
    const t = await this.repo.findById(id);
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    return t;
  }

  /**
   * Regla 01: la asignación siempre la confirma una persona.
   *
   * El cambio de assignee y el evento ASSIGNED tienen que confirmarse
   * juntos: si el evento fallara fuera de una transacción, el ticket
   * quedaría con el nuevo assignee pero sin rastro en el timeline. Mismo
   * idioma que TicketsService.create() / TicketTransitionsService.transition():
   * se escribe a través del EntityManager de la transacción
   * (`manager.getRepository`), no de `this.repo`/`this.events`.
   *
   * La transición de estado (cuando aplica) se delega a
   * TicketTransitionsService.transition(), que abre su propia transacción:
   * se llama después de que la de arriba confirme, nunca anidada dentro de
   * ella.
   */
  async assign(input: {
    ticketId: number;
    actorUserId: number;
    assigneeUserId: number;
    reason?: string;
  }): Promise<Ticket> {
    const current = await this.findOrFail(input.ticketId);

    const updated = await this.repo.runInTransaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const eventRepo = manager.getRepository(TicketEvent);

      await ticketRepo.update(input.ticketId, { assigneeUserId: input.assigneeUserId });

      await eventRepo.save(
        eventRepo.create({
          ticketId: input.ticketId,
          type: 'ASSIGNED',
          actorUserId: input.actorUserId,
          fromStatus: null,
          toStatus: null,
          reason: input.reason?.trim() || null,
          payload: { assigneeUserId: input.assigneeUserId },
        }),
      );

      return (await ticketRepo.findOneBy({ id: input.ticketId }))!;
    });

    // Solo mueve el estado si el ticket aún no había sido asignado.
    if (current.status === 'NUEVO' || current.status === 'TRIAJE') {
      return this.transitions.transition({
        ticketId: input.ticketId,
        actorUserId: input.actorUserId,
        toStatus: 'ASIGNADO',
      });
    }
    return updated;
  }

  /** Regla 02: tomar el ticket lo pone en atención y arranca el reloj de respuesta. */
  take(input: { ticketId: number; actorUserId: number }): Promise<Ticket> {
    return this.repo.update(input.ticketId, { assigneeUserId: input.actorUserId }).then(() =>
      this.transitions.transition({
        ticketId: input.ticketId,
        actorUserId: input.actorUserId,
        toStatus: 'EN_ATENCION',
      }),
    );
  }

  /**
   * Regla 03: derivar exige motivo y nivel destino. El reloj no se reinicia.
   *
   * El nivel/assignee destino se escribe en su propia transacción (mismo
   * idioma que assign()); el paso a DERIVADO y su evento ESCALATED los abre
   * TicketTransitionsService.transition() por separado, nunca anidada dentro
   * de la de arriba.
   */
  async escalate(input: {
    ticketId: number;
    actorUserId: number;
    toLevel: AgentLevel;
    reason: string;
    assigneeUserId?: number;
  }): Promise<Ticket> {
    await this.findOrFail(input.ticketId);

    const patch: Partial<Ticket> = { escalationLevel: input.toLevel };
    if (input.assigneeUserId) patch.assigneeUserId = input.assigneeUserId;

    await this.repo.runInTransaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      await ticketRepo.update(input.ticketId, patch);
    });

    return this.transitions.transition({
      ticketId: input.ticketId,
      actorUserId: input.actorUserId,
      toStatus: 'DERIVADO',
      reason: input.reason,
    });
  }

  /**
   * Cambiar impacto/urgencia recalcula la prioridad. Fijarla a mano marca
   * `priorityOverridden`: a partir de ahí la matriz deja de recalcular.
   *
   * El cambio de prioridad y el evento PRIORITY_OVERRIDDEN tienen que
   * confirmarse juntos: mismo idioma e igual motivo que assign().
   */
  async overridePriority(input: {
    ticketId: number;
    actorUserId: number;
    impact?: TicketImpact;
    urgency?: TicketUrgency;
    priority?: TicketPriority;
    reason: string;
  }): Promise<Ticket> {
    const current = await this.findOrFail(input.ticketId);

    const impact = input.impact ?? current.impact;
    const urgency = input.urgency ?? current.urgency;

    const manual = input.priority !== undefined;
    const priority = manual ? input.priority! : derivePriority(impact, urgency);

    const patch: Partial<Ticket> = {
      impact,
      urgency,
      priority,
      priorityOverridden: manual ? 1 : current.priorityOverridden,
    };

    return this.repo.runInTransaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const eventRepo = manager.getRepository(TicketEvent);

      await ticketRepo.update(input.ticketId, patch);

      await eventRepo.save(
        eventRepo.create({
          ticketId: input.ticketId,
          type: 'PRIORITY_OVERRIDDEN',
          actorUserId: input.actorUserId,
          reason: input.reason,
          payload: { from: current.priority, to: priority, manual },
        }),
      );

      return (await ticketRepo.findOneBy({ id: input.ticketId }))!;
    });
  }

  /**
   * Regla 01: propone el agente activo cuya especialidad cubre la categoría
   * del ticket y que menos tickets abiertos tiene. Es una sugerencia.
   */
  async suggestAssignee(ticketId: number): Promise<SupportAgent | null> {
    const ticket = await this.findOrFail(ticketId);
    if (!ticket.serviceCategory) return null;

    const active = await this.agents.listActive();
    const candidates = active.filter((a) =>
      (a.specialties ?? []).includes(ticket.serviceCategory!),
    );
    if (candidates.length === 0) return null;

    const load = await this.repo.countOpenByAssignee();
    return candidates.reduce((best, a) =>
      (load.get(a.userId) ?? 0) < (load.get(best.userId) ?? 0) ? a : best,
    );
  }
}
