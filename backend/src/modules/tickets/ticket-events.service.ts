import { Injectable } from '@nestjs/common';

import { TicketEventsRepository } from './ticket-events.repository';
import { TicketEvent, TicketEventType } from './entities/ticket-event.entity';
import { TicketStatus } from './domain/ticket-state-machine';

export interface RecordEventInput {
  ticketId: number;
  type: TicketEventType;
  /** null cuando el actor es el sistema (por ejemplo, el job de riesgo). */
  actorUserId: number | null;
  fromStatus?: TicketStatus | null;
  toStatus?: TicketStatus | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Escritura del timeline. Append-only: este servicio no expone actualización
 * ni borrado a propósito — el historial es la evidencia auditable del ticket.
 */
@Injectable()
export class TicketEventsService {
  constructor(private readonly repo: TicketEventsRepository) {}

  record(input: RecordEventInput): Promise<TicketEvent> {
    return this.repo.append({
      ticketId: input.ticketId,
      type: input.type,
      actorUserId: input.actorUserId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      reason: input.reason?.trim() || null,
      payload: input.payload ?? null,
    });
  }

  /**
   * Registra un cambio de estado eligiendo el tipo de evento más específico
   * disponible, para que el timeline se lea sin tener que interpretar estados.
   */
  recordStatusChange(input: {
    ticketId: number;
    actorUserId: number | null;
    fromStatus: TicketStatus;
    toStatus: TicketStatus;
    reason?: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<TicketEvent> {
    return this.record({
      ...input,
      type: this.typeForTransition(input.fromStatus, input.toStatus),
    });
  }

  private typeForTransition(from: TicketStatus, to: TicketStatus): TicketEventType {
    if (to === 'DERIVADO') return 'ESCALATED';
    if (to === 'RESUELTO') return 'RESOLVED';
    if (to === 'CERRADO') return 'CLOSED';
    if (from === 'RESUELTO' && to === 'EN_ATENCION') return 'REOPENED';
    if (to === 'TRIAJE') return 'TRIAGED';
    if (to === 'EN_ATENCION' && from === 'ASIGNADO') return 'TAKEN';
    return 'STATUS_CHANGED';
  }

  listByTicket(ticketId: number): Promise<TicketEvent[]> {
    return this.repo.listByTicket(ticketId);
  }
}
