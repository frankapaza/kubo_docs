export type TicketImpact = 'ALTO' | 'MEDIO' | 'BAJO';
export type TicketUrgency = 'ALTA' | 'MEDIA' | 'BAJA';
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';

export const TICKET_IMPACTS: TicketImpact[] = ['ALTO', 'MEDIO', 'BAJO'];
export const TICKET_URGENCIES: TicketUrgency[] = ['ALTA', 'MEDIA', 'BAJA'];
export const TICKET_PRIORITIES: TicketPriority[] = ['P1', 'P2', 'P3', 'P4'];

/** Prioridad cuando no se conoce impacto o urgencia. */
export const DEFAULT_PRIORITY: TicketPriority = 'P3';

const MATRIX: Record<TicketImpact, Record<TicketUrgency, TicketPriority>> = {
  ALTO: { ALTA: 'P1', MEDIA: 'P2', BAJA: 'P3' },
  MEDIO: { ALTA: 'P2', MEDIA: 'P3', BAJA: 'P3' },
  BAJO: { ALTA: 'P3', MEDIA: 'P4', BAJA: 'P4' },
};

/**
 * Deriva la prioridad del ticket a partir de la matriz impacto x urgencia.
 * Función pura: no consulta base de datos ni depende de la política de SLA.
 */
export function derivePriority(
  impact: TicketImpact | null,
  urgency: TicketUrgency | null,
): TicketPriority {
  if (!impact || !urgency) return DEFAULT_PRIORITY;
  return MATRIX[impact][urgency];
}
