import type { TicketEventType, TicketPriority, TicketStatus } from '../../api/types';

export interface Swatch {
  bg: string;
  fg: string;
}

/** Paleta del prototipo Claude Design (oklch). */
export const STATUS_STYLES: Record<TicketStatus, Swatch> = {
  NUEVO:          { bg: 'oklch(0.95 0.03 205)', fg: 'oklch(0.52 0.1 205)' },
  TRIAJE:         { bg: 'oklch(0.95 0.04 290)', fg: 'oklch(0.45 0.13 290)' },
  ASIGNADO:       { bg: 'oklch(0.94 0.05 78)',  fg: 'oklch(0.5 0.11 70)' },
  EN_ATENCION:    { bg: 'oklch(0.94 0.05 78)',  fg: 'oklch(0.5 0.11 70)' },
  ESPERA_CLIENTE: { bg: '#eceeef',              fg: '#4a5052' },
  DERIVADO:       { bg: 'oklch(0.95 0.04 290)', fg: 'oklch(0.45 0.13 290)' },
  RESUELTO:       { bg: 'oklch(0.94 0.05 150)', fg: 'oklch(0.45 0.11 150)' },
  CERRADO:        { bg: '#eceeef',              fg: '#4a5052' },
};

export const PRIORITY_STYLES: Record<TicketPriority, Swatch> = {
  P1: { bg: 'oklch(0.94 0.04 25)',  fg: 'oklch(0.5 0.16 25)' },
  P2: { bg: 'oklch(0.94 0.05 78)',  fg: 'oklch(0.5 0.11 70)' },
  P3: { bg: 'oklch(0.95 0.03 205)', fg: 'oklch(0.52 0.1 205)' },
  P4: { bg: '#eceeef',              fg: '#4a5052' },
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  NUEVO: 'Nuevo',
  TRIAJE: 'Triaje',
  ASIGNADO: 'Asignado',
  EN_ATENCION: 'En atención',
  ESPERA_CLIENTE: 'Espera cliente',
  DERIVADO: 'Derivado',
  RESUELTO: 'Resuelto',
  CERRADO: 'Cerrado',
};

/** Color del punto de línea de tiempo por tipo de evento; sin entrada usa el color por defecto de TicketTimeline. */
export const TIMELINE_EVENT_DOTS: Partial<Record<TicketEventType, string>> = {
  CREATED: 'oklch(0.52 0.1 205)',
  TRIAGED: 'oklch(0.45 0.13 290)',
  ESCALATED: 'oklch(0.45 0.13 290)',
  RESOLVED: 'oklch(0.45 0.11 150)',
  CLOSED: '#4a5052',
  SLA_AT_RISK: 'oklch(0.5 0.16 25)',
  REOPENED: 'oklch(0.5 0.11 70)',
};

/** Verde con margen, ámbar acercándose al umbral, rojo pasado o vencido. */
export function slaBarColor(pct: number | null, overdue: boolean): string {
  if (overdue) return 'oklch(0.5 0.16 25)';
  if (pct === null) return '#e2e5e6';
  if (pct >= 70) return 'oklch(0.5 0.16 25)';
  if (pct >= 45) return 'oklch(0.68 0.14 78)';
  return 'oklch(0.6 0.12 150)';
}
