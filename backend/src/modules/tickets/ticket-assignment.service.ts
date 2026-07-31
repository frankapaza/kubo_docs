import { Injectable, NotFoundException } from '@nestjs/common';

import { TicketsRepository } from './tickets.repository';
import { TicketTransitionsService } from './ticket-transitions.service';
import { SupportAgentsRepository } from './support-agents.repository';

import { Ticket, AgentLevel } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { SupportAgent } from './entities/support-agent.entity';
import { assertTransition } from './domain/ticket-state-machine';
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

  /**
   * Regla 02: tomar el ticket lo pone en atención y arranca el reloj de respuesta.
   *
   * `EN_ATENCION` solo es alcanzable desde `ASIGNADO`, `ESPERA_CLIENTE`,
   * `DERIVADO` o `RESUELTO` (ver `domain/ticket-state-machine`). Se valida
   * con `assertTransition` **antes** de escribir nada: si se tomara un
   * ticket `NUEVO`/`TRIAJE`, el patch de `assigneeUserId` se confirmaría y
   * la transición de abajo lanzaría después, dejando un assignee sin
   * ningún cambio de estado y sin rastro en el timeline (`take` no escribe
   * su propio evento; el único evento de esta operación lo escribe
   * `transitions.transition`). La comprobación de aquí es de orden, no
   * sustituye la que ya hace `transition()` — esta última la repite y es lo
   * esperado.
   */
  async take(input: { ticketId: number; actorUserId: number }): Promise<Ticket> {
    const current = await this.findOrFail(input.ticketId);
    assertTransition(current.status, 'EN_ATENCION');

    await this.repo.update(input.ticketId, { assigneeUserId: input.actorUserId });
    return this.transitions.transition({
      ticketId: input.ticketId,
      actorUserId: input.actorUserId,
      toStatus: 'EN_ATENCION',
    });
  }

  /**
   * Regla 03: derivar exige motivo y nivel destino. El reloj no se reinicia.
   *
   * El nivel/assignee destino se escribe en su propia transacción (mismo
   * idioma que assign()); el paso a DERIVADO y su evento ESCALATED los abre
   * TicketTransitionsService.transition() por separado, nunca anidada dentro
   * de la de arriba.
   *
   * `DERIVADO` solo es alcanzable desde `ASIGNADO` o `EN_ATENCION`. Igual que
   * en `take()`, se valida con `assertTransition` antes de escribir el patch:
   * si no, un ticket en cualquier otro estado se quedaría con
   * `escalationLevel` cambiado y ninguna transición ni evento, porque
   * `transition()` lanzaría después de que el patch ya hubiera confirmado.
   */
  async escalate(input: {
    ticketId: number;
    actorUserId: number;
    toLevel: AgentLevel;
    reason: string;
    assigneeUserId?: number;
  }): Promise<Ticket> {
    const current = await this.findOrFail(input.ticketId);
    assertTransition(current.status, 'DERIVADO');

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
