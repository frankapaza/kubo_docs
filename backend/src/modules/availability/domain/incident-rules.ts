import type { TrackerState } from '../core';

/** Ventana de la decisión 19: servicios del mismo servidor que confirman en 3 min forman un incidente de servidor. */
export const GROUPING_WINDOW_MS = 180_000;
/** Decisión 15: una recaída antes de 30 min reabre el mismo incidente. */
export const REOPEN_WINDOW_MS = 1_800_000;
/** Espera máxima de la comprobación cruzada de la otra sonda. */
export const CROSS_TIMEOUT_MS = 120_000;

export interface OpenSibling {
  incidentId: number;
  confirmedAt: Date;
  parentId: number | null;
}

export type GroupDecision =
  | { action: 'ALONE' }
  | { action: 'JOIN_PARENT'; parentId: number }
  | { action: 'CREATE_PARENT'; siblingIds: number[] };

/**
 * Con incidente de servidor abierto, el servicio se suma a él. Si no, los
 * incidentes sueltos (sin padre) de otros servicios del mismo servidor
 * confirmados a menos de 3 min forman uno nuevo.
 */
export function groupDecision(
  newConfirmedAt: Date,
  openSiblings: OpenSibling[],
  openServerParentId: number | null,
): GroupDecision {
  if (openServerParentId !== null) return { action: 'JOIN_PARENT', parentId: openServerParentId };
  const t = newConfirmedAt.getTime();
  const siblingIds = openSiblings
    .filter((s) => s.parentId === null && Math.abs(t - s.confirmedAt.getTime()) <= GROUPING_WINDOW_MS)
    .map((s) => s.incidentId);
  return siblingIds.length > 0 ? { action: 'CREATE_PARENT', siblingIds } : { action: 'ALONE' };
}

/** Solo DOWN/ROUTE cerrados por recuperación medida hace menos de 30 min. */
export function reopenCandidate(
  lastClosed: { id: number; kind: string; recoveredAt: Date; closeReason: string } | null,
  now: Date,
): number | null {
  if (!lastClosed) return null;
  if (lastClosed.kind !== 'DOWN' && lastClosed.kind !== 'ROUTE') return null;
  if (lastClosed.closeReason !== 'RECOVERED') return null;
  const age = now.getTime() - lastClosed.recoveredAt.getTime();
  return age < REOPEN_WINDOW_MS ? lastClosed.id : null;
}

/**
 * ¿Basta el estado actual de las sondas para cerrar el incidente?
 * `office` null = sin datos de la oficina (caída de oficina o sin fila).
 * DEGRADED solo lo cierra la señal DEGRADATION_CLEARED.
 */
export function recoveryCloses(
  kind: 'DOWN' | 'ROUTE' | 'DEGRADED',
  office: TrackerState | null,
  dc: TrackerState | null,
): boolean {
  if (kind === 'ROUTE') return office === 'OK';
  if (kind === 'DOWN') return dc === 'OK' && (office === 'OK' || office === null);
  return false;
}

/** Duración legible para el comentario de recuperación. */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return 'menos de 1 min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')} min`;
}
