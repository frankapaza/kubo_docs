/**
 * Reglas de la alerta de latencia por hora (spec 2026-11-28-alerta-latencia).
 * Puras: sin base de datos ni reloj.
 */

/** Hora lenta: al menos este share de pings sobre el umbral (o fallidos). */
export const SLOW_SHARE = 0.2;
/** Con menos pings en la hora no se juzga (motor apagado, corte): ni abre ni cierra. */
export const MIN_PINGS = 10;

export interface HourStats {
  total: number;
  slow: number;
  avgMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export function summarizeHour(checks: Array<{ durationMs: number; ok: boolean }>, thresholdMs: number): HourStats {
  const okMs = checks.filter((c) => c.ok).map((c) => Number(c.durationMs)).sort((a, b) => a - b);
  const slow = checks.filter((c) => !c.ok || Number(c.durationMs) > thresholdMs).length;
  if (okMs.length === 0) return { total: checks.length, slow, avgMs: null, p95Ms: null, maxMs: null };
  const avgMs = Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length);
  const p95Ms = okMs[Math.max(0, Math.ceil(0.95 * okMs.length) - 1)];
  return { total: checks.length, slow, avgMs, p95Ms, maxMs: okMs[okMs.length - 1] };
}

export function hasEnoughData(s: { total: number }): boolean {
  return s.total >= MIN_PINGS;
}

export function isSlowHour(s: { total: number; slow: number }): boolean {
  return hasEnoughData(s) && s.slow / s.total >= SLOW_SHARE;
}

/** Todos los pings con datos lentos en la misma hora (≥ 2): probable internet de la oficina. */
export function isOfficeWide(slowFlags: boolean[]): boolean {
  return slowFlags.length >= 2 && slowFlags.every(Boolean);
}

/** Qué hacer con el episodio de un ping al cerrar una hora. */
export function episodeStep(open: boolean, s: { total: number; slow: number }): 'OPEN' | 'CLOSE' | 'NONE' {
  if (!hasEnoughData(s)) return 'NONE';
  const slow = isSlowHour(s);
  if (slow && !open) return 'OPEN';
  if (!slow && open) return 'CLOSE';
  return 'NONE';
}
