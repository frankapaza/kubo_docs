/**
 * Histogramas por cubetas: cada número es el límite inferior inclusivo de su
 * cubeta y la última cubeta llega hasta +∞. Los percentiles mensuales salen de
 * sumar histogramas diarios (no de promediar percentiles).
 *
 * Latencia (ms): la última cubeta es [10000, +∞). No se guarda `Infinity` en el
 * arreglo porque JSON lo convierte en `null`.
 */
export const LATENCY_BUCKETS_MS: number[] = [
  0, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000,
];

/** Cubetas de porcentaje (CPU y RAM del agente): 0, 5, …, 95, 100. */
export const PERCENT_BUCKETS: number[] = Array.from({ length: 21 }, (_, i) => i * 5);

/** Índice de la cubeta de `v`: la mayor cuyo límite inferior es ≤ v (valores negativos → 0). */
function bucketIndex(v: number, bounds: number[]): number {
  let i = 0;
  while (i + 1 < bounds.length && v >= bounds[i + 1]) i++;
  return i;
}

export function histogramOf(values: number[], bounds: number[] = LATENCY_BUCKETS_MS): number[] {
  const h = new Array<number>(bounds.length).fill(0);
  for (const v of values) h[bucketIndex(v, bounds)]++;
  return h;
}

/** Suma cubeta a cubeta; el resultado tiene el largo del histograma más largo. */
export function mergeHistograms(hs: number[][]): number[] {
  const len = hs.reduce((m, h) => Math.max(m, h.length), 0);
  const out = new Array<number>(len).fill(0);
  for (const h of hs) h.forEach((n, i) => (out[i] += n));
  return out;
}

/**
 * Percentil `p` (0-1): el límite superior de la primera cubeta cuyo acumulado
 * alcanza `p`. La última cubeta no tiene límite superior y devuelve su límite
 * inferior. Histograma vacío → null.
 */
export function percentileFromHistogram(h: number[], p: number, bounds: number[] = LATENCY_BUCKETS_MS): number | null {
  const total = h.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const target = p * total;
  let acc = 0;
  for (let i = 0; i < h.length; i++) {
    acc += h[i];
    if (acc > 0 && acc >= target) return i + 1 < bounds.length ? bounds[i + 1] : bounds[bounds.length - 1];
  }
  return bounds[bounds.length - 1];
}
