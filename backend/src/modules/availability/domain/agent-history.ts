import { addDays, limaDateOf, limaDayBounds } from './expected-slots';
import { PERCENT_BUCKETS, percentileFromHistogram } from './latency-histogram';

/** Rango de la vista de historial del servidor. */
export type HistoryRange = 'day' | 'month' | 'year';
export const HISTORY_RANGES: HistoryRange[] = ['day', 'month', 'year'];

/** Muestra del agente, solo lo que usa el historial. */
export interface HistorySample {
  at: Date;
  cpuPct: number;
  ramPct: number;
  eventErrors: number;
}

/** Resumen diario guardado (monitor_agent_daily_rollups). */
export interface HistoryDailyRollup {
  date: string;
  samples: number;
  cpuHist: number[];
  ramHist: number[];
  cpuAvg: number | null;
  cpuMax: number | null;
  ramAvg: number | null;
  ramMax: number | null;
  eventErrors: number;
}

/** Un punto del historial. Sin muestras: `samples` 0 y las métricas en null. */
export interface HistoryPoint {
  /** 'YYYY-MM-DDTHH:mm' (hora de Lima) en `day`, 'YYYY-MM-DD' en `month`, 'YYYY-MM' en `year`. */
  key: string;
  /** Inicio del tramo (UTC). */
  from: string;
  samples: number;
  cpuAvg: number | null;
  cpuMax: number | null;
  ramAvg: number | null;
  ramMax: number | null;
  errors: number;
}

export interface SampleSummary {
  samples: number;
  cpuAvg: number | null;
  cpuMax: number | null;
  ramAvg: number | null;
  ramMax: number | null;
  eventErrors: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const MIN_MS = 60_000;
/** Tramo de la vista de un día: 96 puntos de 15 minutos. */
export const DAY_BUCKET_MIN = 15;
const LIMA_OFFSET_MS = 5 * 60 * MIN_MS;

/** Media, máximo y suma de errores de un conjunto de muestras. */
export function summarizeSamples(samples: HistorySample[]): SampleSummary {
  if (samples.length === 0) return { samples: 0, cpuAvg: null, cpuMax: null, ramAvg: null, ramMax: null, eventErrors: 0 };
  let cpu = 0;
  let ram = 0;
  let cpuMax = -Infinity;
  let ramMax = -Infinity;
  let errors = 0;
  for (const s of samples) {
    cpu += s.cpuPct;
    ram += s.ramPct;
    cpuMax = Math.max(cpuMax, s.cpuPct);
    ramMax = Math.max(ramMax, s.ramPct);
    errors += s.eventErrors;
  }
  return {
    samples: samples.length,
    cpuAvg: round2(cpu / samples.length),
    cpuMax: round2(cpuMax),
    ramAvg: round2(ram / samples.length),
    ramMax: round2(ramMax),
    eventErrors: errors,
  };
}

const point = (key: string, from: Date, s: SampleSummary): HistoryPoint => ({
  key,
  from: from.toISOString(),
  samples: s.samples,
  cpuAvg: s.cpuAvg,
  cpuMax: s.cpuMax,
  ramAvg: s.ramAvg,
  ramMax: s.ramMax,
  errors: s.eventErrors,
});

/** Últimas 24 h en tramos de 15 minutos alineados al reloj; el último contiene `now`. */
export function dayHistory(samples: HistorySample[], now: Date): HistoryPoint[] {
  const step = DAY_BUCKET_MIN * MIN_MS;
  const lastStart = Math.floor(now.getTime() / step) * step;
  const firstStart = lastStart - (24 * 60 / DAY_BUCKET_MIN - 1) * step;
  const buckets = new Map<number, HistorySample[]>();
  for (const s of samples) {
    const t = new Date(s.at).getTime();
    if (t < firstStart || t >= lastStart + step) continue;
    const k = Math.floor(t / step) * step;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(s);
  }
  const out: HistoryPoint[] = [];
  for (let t = firstStart; t <= lastStart; t += step) {
    const key = new Date(t - LIMA_OFFSET_MS).toISOString().slice(0, 16);
    out.push(point(key, new Date(t), summarizeSamples(buckets.get(t) ?? [])));
  }
  return out;
}

/** Últimos 30 días de Lima (hoy incluido), uno por día, desde las muestras. */
export function monthHistory(samples: HistorySample[], now: Date): HistoryPoint[] {
  const today = limaDateOf(now);
  const byDate = new Map<string, HistorySample[]>();
  for (const s of samples) {
    const d = limaDateOf(new Date(s.at));
    (byDate.get(d) ?? byDate.set(d, []).get(d)!).push(s);
  }
  const out: HistoryPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push(point(date, limaDayBounds(date).from, summarizeSamples(byDate.get(date) ?? [])));
  }
  return out;
}

/** Resumen de un día guardado, con los histogramas como respaldo si faltan las columnas de la 038. */
function rollupSummary(r: HistoryDailyRollup): SampleSummary {
  const fromHist = (h: number[], p: number) => percentileFromHistogram(h, p, PERCENT_BUCKETS);
  return {
    samples: r.samples,
    cpuAvg: r.cpuAvg ?? fromHist(r.cpuHist, 0.5),
    cpuMax: r.cpuMax ?? fromHist(r.cpuHist, 1),
    ramAvg: r.ramAvg ?? fromHist(r.ramHist, 0.5),
    ramMax: r.ramMax ?? fromHist(r.ramHist, 1),
    eventErrors: r.eventErrors ?? 0,
  };
}

/** Combina resúmenes: media ponderada por muestras, máximo de máximos, suma de errores. */
export function mergeSummaries(parts: SampleSummary[]): SampleSummary {
  const withData = parts.filter((p) => p.samples > 0);
  const samples = withData.reduce((a, p) => a + p.samples, 0);
  const errors = parts.reduce((a, p) => a + p.eventErrors, 0);
  if (samples === 0) return { samples: 0, cpuAvg: null, cpuMax: null, ramAvg: null, ramMax: null, eventErrors: errors };
  const wavg = (pick: (p: SampleSummary) => number | null) => {
    const usable = withData.filter((p) => pick(p) !== null);
    const n = usable.reduce((a, p) => a + p.samples, 0);
    return n === 0 ? null : round2(usable.reduce((a, p) => a + (pick(p) as number) * p.samples, 0) / n);
  };
  const max = (pick: (p: SampleSummary) => number | null) => {
    const vals = withData.map(pick).filter((v): v is number => v !== null);
    return vals.length ? round2(Math.max(...vals)) : null;
  };
  return {
    samples,
    cpuAvg: wavg((p) => p.cpuAvg),
    cpuMax: max((p) => p.cpuMax),
    ramAvg: wavg((p) => p.ramAvg),
    ramMax: max((p) => p.ramMax),
    eventErrors: errors,
  };
}

/**
 * Últimos 12 meses de Lima (el actual incluido), uno por mes. Los días ya
 * resumidos salen de `rollups`; el día de hoy, que aún no tiene resumen, de
 * `todaySamples`.
 */
export function yearHistory(rollups: HistoryDailyRollup[], todaySamples: HistorySample[], now: Date): HistoryPoint[] {
  const today = limaDateOf(now);
  const byMonth = new Map<string, SampleSummary[]>();
  const add = (month: string, s: SampleSummary) => (byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(s);
  for (const r of rollups) if (r.date < today) add(r.date.slice(0, 7), rollupSummary(r));
  add(today.slice(0, 7), summarizeSamples(todaySamples));

  const [y, m] = today.split('-').map(Number);
  const out: HistoryPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const month = d.toISOString().slice(0, 7);
    out.push(point(month, limaDayBounds(`${month}-01`).from, mergeSummaries(byMonth.get(month) ?? [])));
  }
  return out;
}

/** Primer día (Lima) que necesita la vista anual: el día 1 de hace 11 meses. */
export function yearStartDate(now: Date): string {
  const [y, m] = limaDateOf(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10);
}
