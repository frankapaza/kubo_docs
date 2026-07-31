import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { TicketsRepository } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { SlaService } from './sla.service';
import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import {
  TicketStatus,
  assertTransition,
  requiresReason,
  isReopen,
} from './domain/ticket-state-machine';

export interface TransitionInput {
  ticketId: number;
  actorUserId: number;
  toStatus: TicketStatus;
  reason?: string;
  resolutionMd?: string;
  rootCause?: string;
  correctiveAction?: string;
}

/**
 * Único camino por el que un ticket cambia de estado. Concentra las reglas
 * de negocio del prototipo (§4 de la spec) y garantiza que toda transición
 * quede escrita en el timeline.
 */
@Injectable()
export class TicketTransitionsService {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly events: TicketEventsService,
    private readonly sla: SlaService,
  ) {}

  async transition(input: TransitionInput): Promise<Ticket> {
    const current = await this.repo.findById(input.ticketId);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    }

    const from = current.status;
    const to = input.toStatus;

    assertTransition(from, to);

    const reason = input.reason?.trim() || null;
    if (requiresReason(from, to) && !reason) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Esta transición exige indicar un motivo.',
      });
    }

    const now = new Date();
    const patch: Partial<Ticket> = { status: to };

    // Regla 05 — no se resuelve sin evidencia.
    if (to === 'RESUELTO') {
      const resolutionMd = input.resolutionMd?.trim() || current.resolutionMd;
      const rootCause = input.rootCause?.trim() || current.rootCause;
      const correctiveAction = input.correctiveAction?.trim() || current.correctiveAction;

      if (!resolutionMd || !rootCause || !correctiveAction) {
        throw new BadRequestException({
          code: 'BAD_INPUT',
          message:
            'Para resolver hay que registrar solución aplicada, causa raíz y acción correctiva.',
        });
      }
      patch.resolutionMd = resolutionMd;
      patch.rootCause = rootCause;
      patch.correctiveAction = correctiveAction;
      patch.resolvedAt = now;
      if (!current.attendedAt) patch.attendedAt = now;
    }

    if (to === 'CERRADO') patch.closedAt = now;

    // Reapertura: se limpia la marca de resolución pero se conserva el texto,
    // para que el técnico lo corrija en vez de reescribirlo desde cero.
    if (isReopen(from, to)) patch.resolvedAt = null;

    // El reloj solo se detiene en ESPERA_CLIENTE.
    if (to === 'ESPERA_CLIENTE') {
      patch.pausedAt = now;
    } else if (from === 'ESPERA_CLIENTE') {
      const resumed = this.sla.applyPause(current, now);
      patch.pausedAt = resumed.pausedAt;
      patch.pausedTotalSeconds = resumed.pausedTotalSeconds;
      patch.slaResponseDueAt = resumed.slaResponseDueAt;
      patch.slaResolutionDueAt = resumed.slaResolutionDueAt;
    }

    // Regla 02 — la primera entrada en atención es la primera respuesta.
    if (to === 'EN_ATENCION' && !current.firstResponseAt) {
      patch.firstResponseAt = now;
    }

    // El cambio de estado y el evento de timeline tienen que confirmarse
    // juntos: si el evento fallara fuera de una transacción, el ticket
    // quedaría con el estado nuevo pero sin rastro en el timeline, rompiendo
    // el invariante de auditoría del que depende todo el detalle. Mismo
    // idioma que TicketsService.create(): se escribe a través del
    // EntityManager de la transacción (`manager.getRepository`), no de
    // `this.repo`/`this.events` — esos usan su propia conexión y no
    // participarían del commit/rollback.
    return this.repo.runInTransaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const eventRepo = manager.getRepository(TicketEvent);

      await ticketRepo.update(input.ticketId, patch);

      await eventRepo.save(
        eventRepo.create({
          ticketId: input.ticketId,
          type: this.events.typeForTransition(from, to),
          actorUserId: input.actorUserId,
          fromStatus: from,
          toStatus: to,
          reason,
          payload: null,
        }),
      );

      return (await ticketRepo.findOneBy({ id: input.ticketId }))!;
    });
  }
}
