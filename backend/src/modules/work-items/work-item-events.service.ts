import { Injectable } from '@nestjs/common';

import { WorkItemEventsRepository } from './work-item-events.repository';
import { WorkItemEvent, WorkItemEventType } from './entities/work-item-event.entity';
import { WorkItemStatus } from './domain/work-item-board';

export interface RecordWorkItemEventInput {
  workItemId: number;
  type: WorkItemEventType;
  actorUserId: number | null;
  fromStatus?: WorkItemStatus | null;
  toStatus?: WorkItemStatus | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
}

/** Append-only: sin actualización ni borrado, a propósito. */
@Injectable()
export class WorkItemEventsService {
  constructor(private readonly repo: WorkItemEventsRepository) {}

  record(input: RecordWorkItemEventInput): Promise<WorkItemEvent> {
    return this.repo.append({
      workItemId: input.workItemId,
      type: input.type,
      actorUserId: input.actorUserId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      reason: input.reason?.trim() || null,
      payload: input.payload ?? null,
    });
  }

  /**
   * Tipo de evento más específico para un movimiento, para que el timeline se
   * lea sin tener que interpretar pares de estados. Público porque el servicio
   * de tablero lo necesita dentro de su transacción.
   */
  typeForMove(from: WorkItemStatus, to: WorkItemStatus): WorkItemEventType {
    if (to === 'BLOQUEADO') return 'BLOCKED';
    if (to === 'CANCELADO') return 'CANCELLED';
    if (to === 'CERRADO') return 'CLOSED';
    if (from === 'CERRADO') return 'REOPENED';
    if (from === 'BLOQUEADO') return 'UNBLOCKED';
    return 'MOVED';
  }

  listByItem(workItemId: number): Promise<WorkItemEvent[]> {
    return this.repo.listByItem(workItemId);
  }
}
