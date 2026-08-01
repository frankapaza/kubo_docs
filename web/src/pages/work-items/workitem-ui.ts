import type { WorkItemPriority, WorkItemStatus } from '../../api/types';

export interface Swatch { bg: string; fg: string }

/** Las cuatro columnas de flujo, en orden. */
export const BOARD_COLUMNS: WorkItemStatus[] = ['PENDIENTE', 'EN_PROCESO', 'PRUEBAS', 'CERRADO'];

export const STATUS_LABELS: Record<WorkItemStatus, string> = {
  PENDIENTE: 'Pendiente',
  EN_PROCESO: 'En proceso',
  PRUEBAS: 'Pruebas',
  CERRADO: 'Cerrado',
  BLOQUEADO: 'Bloqueado',
  CANCELADO: 'Cancelado',
};

export const PRIORITY_STYLES: Record<WorkItemPriority, Swatch> = {
  ALTA:  { bg: 'oklch(0.94 0.04 25)',  fg: 'oklch(0.5 0.16 25)' },
  MEDIA: { bg: 'oklch(0.94 0.05 78)',  fg: 'oklch(0.5 0.11 70)' },
  BAJA:  { bg: '#eceeef',              fg: '#4a5052' },
};

export const OUT_OF_FLOW_STYLES: Record<'BLOQUEADO' | 'CANCELADO', Swatch> = {
  BLOQUEADO: { bg: 'oklch(0.95 0.04 290)', fg: 'oklch(0.45 0.13 290)' },
  CANCELADO: { bg: '#eceeef',              fg: '#6d7577' },
};

/**
 * Color de la etiqueta de fecha. No es un SLA: solo informa.
 * Un ítem cerrado o cancelado nunca se pinta como vencido.
 */
export function dueDateStyle(
  dueDate: string | null,
  status: WorkItemStatus,
): { color: string; overdue: boolean } {
  if (!dueDate) return { color: '#6d7577', overdue: false };
  if (status === 'CERRADO' || status === 'CANCELADO') return { color: '#6d7577', overdue: false };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return { color: 'oklch(0.5 0.16 25)', overdue: true };
  if (days <= 3) return { color: 'oklch(0.5 0.11 70)', overdue: false };
  return { color: '#6d7577', overdue: false };
}
