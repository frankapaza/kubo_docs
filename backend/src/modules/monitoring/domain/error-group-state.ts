import { ConflictException } from '@nestjs/common';
import { TicketStatus } from '../../tickets/domain/ticket-state-machine';

export type ErrorGroupStatus = 'NUEVO' | 'CON_TICKET' | 'RESUELTO';

export interface LinkedTicketState {
  code: string;
  status: TicketStatus;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

export interface GroupState {
  status: ErrorGroupStatus;
  resolvedAt: Date | null;
  ticketId: number | null;
  /** `null` con `ticketId` informado significa que el ticket fue borrado. */
  ticket: LinkedTicketState | null;
}

export interface OccurrenceDecision {
  status: ErrorGroupStatus;
  /** ¿Hay que avisar al personal (error nuevo o reaparecido)? */
  notify: boolean;
  reopened: boolean;
  reason: string | null;
}

const IGUAL = (status: ErrorGroupStatus): OccurrenceDecision => ({
  status,
  notify: false,
  reopened: false,
  reason: null,
});

const reabrir = (reason: string): OccurrenceDecision => ({
  status: 'NUEVO',
  notify: true,
  reopened: true,
  reason,
});

/**
 * Qué pasa con un grupo cuando entra una ocurrencia.
 *
 * Se compara contra `occurredAt` (cuándo ocurrió) y no contra "ahora": las
 * ocurrencias pueden llegar tarde desde la cola de un appender, y una
 * anterior a la resolución no prueba que el error siga vivo. La igualdad
 * exacta cuenta como "no posterior" y tampoco reabre.
 */
export function decideOnOccurrence(group: GroupState | null, occurredAt: Date): OccurrenceDecision {
  if (!group) return { status: 'NUEVO', notify: true, reopened: false, reason: null };

  if (group.status === 'NUEVO') return IGUAL('NUEVO');

  if (group.status === 'RESUELTO') {
    if (!group.resolvedAt || occurredAt.getTime() > group.resolvedAt.getTime()) {
      return reabrir('Reapareció después de marcarse como resuelto');
    }
    return IGUAL('RESUELTO');
  }

  // CON_TICKET
  if (!group.ticket) return reabrir('Reapareció y su ticket ya no existe');
  const t = group.ticket;
  if (t.status === 'RESUELTO' || t.status === 'CERRADO') {
    const fin = t.resolvedAt ?? t.closedAt;
    if (fin && occurredAt.getTime() > fin.getTime()) {
      return reabrir(`Reapareció tras el ticket ${t.code}`);
    }
  }
  return IGUAL('CON_TICKET');
}

function conflicto(message: string): never {
  throw new ConflictException({ code: 'CONFLICT', message });
}

/** Un grupo con ticket no admite otro: evita tickets duplicados por el mismo error. */
export function assertCanCreateTicket(s: ErrorGroupStatus): void {
  if (s === 'CON_TICKET') conflicto('Este error ya tiene un ticket');
}

export function assertCanResolve(s: ErrorGroupStatus): void {
  if (s === 'RESUELTO') conflicto('Este error ya está resuelto');
}

export function assertCanReopen(s: ErrorGroupStatus): void {
  if (s === 'NUEVO') conflicto('Este error ya está abierto');
}
