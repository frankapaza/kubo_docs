const DAY_MS = 86_400_000;
/** Ventana de la tendencia: los últimos 7 días. */
export const DISK_TREND_WINDOW_MS = 7 * DAY_MS;
/** Más allá de 10 años la estimación no dice nada útil. */
export const DISK_TREND_MAX_DAYS = 3650;

/**
 * Días hasta llenar el disco: recta por mínimos cuadrados del espacio libre en
 * los últimos 7 días (contados desde el punto más reciente), extrapolada a cero
 * desde el último valor. null si hay menos de 2 puntos, si el espacio no baja
 * o si el resultado pasa de 3650 días.
 */
export function estimateDaysToFull(points: Array<{ at: Date; freeBytes: number }>): number | null {
  if (points.length < 2) return null;
  const latest = points.reduce((a, p) => (p.at.getTime() > a.at.getTime() ? p : a));
  const since = latest.at.getTime() - DISK_TREND_WINDOW_MS;
  const pts = points.filter((p) => p.at.getTime() >= since);
  if (pts.length < 2) return null;

  // x en días relativos al punto más reciente (evita perder precisión con epoch en ms).
  const xs = pts.map((p) => (p.at.getTime() - latest.at.getTime()) / DAY_MS);
  const ys = pts.map((p) => Number(p.freeBytes));
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx; // bytes por día
  if (slope >= 0) return null;
  const days = Number(latest.freeBytes) / -slope;
  return days > DISK_TREND_MAX_DAYS ? null : days;
}
