import { PROBE_SILENCE_MS } from './probe-silence';

/**
 * Huecos de más de `minGapMs` sin ninguna comprobación de una sonda en
 * [from, to): entre checks consecutivos, desde `from` hasta el primero y desde
 * el último hasta `to`. Sin checks, el día entero es un hueco.
 * `startedAtSorted` viene ordenado ascendente; lo que cae fuera del día se ignora.
 */
export function probeGaps(
  startedAtSorted: Date[],
  from: Date,
  to: Date,
  minGapMs: number = PROBE_SILENCE_MS,
): Array<[Date, Date]> {
  const gaps: Array<[Date, Date]> = [];
  let prev = from;
  const consider = (next: Date) => {
    if (next.getTime() - prev.getTime() > minGapMs) gaps.push([prev, next]);
    prev = next;
  };
  for (const t of startedAtSorted) {
    if (t.getTime() < from.getTime() || t.getTime() >= to.getTime()) continue;
    consider(t);
  }
  consider(to);
  return gaps;
}

/**
 * Partes de `interval` que no cubre ninguno de `cuts` (pueden venir desordenados
 * o solaparse). Sirve para que un silencio dentro de una caída de oficina se
 * guarde una sola vez, como OFFICE_OUTAGE.
 */
export function subtractIntervals(interval: [Date, Date], cuts: Array<[Date, Date]>): Array<[Date, Date]> {
  const sorted = [...cuts].sort((a, b) => a[0].getTime() - b[0].getTime());
  const out: Array<[Date, Date]> = [];
  let cursor = interval[0].getTime();
  const end = interval[1].getTime();
  for (const [a, b] of sorted) {
    if (b.getTime() <= cursor) continue;
    if (a.getTime() >= end) break;
    if (a.getTime() > cursor) out.push([new Date(cursor), a]);
    cursor = Math.max(cursor, b.getTime());
    if (cursor >= end) return out;
  }
  if (cursor < end) out.push([new Date(cursor), interval[1]]);
  return out;
}
