import { DEFAULT_SCHEDULE, LIMA_OFFSET_MINUTES, nextCycleAt } from '../core';
import type { ScheduleConfig } from '../core';

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;
const LIMA_SHIFT_MS = LIMA_OFFSET_MINUTES * MIN_MS;

/** Inicio (00:00 Lima, incluido) y fin (00:00 Lima del día siguiente, excluido) de una fecha 'YYYY-MM-DD'. */
export function limaDayBounds(date: string): { from: Date; to: Date } {
  const [y, m, d] = date.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d) - LIMA_SHIFT_MS);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/** Fecha 'YYYY-MM-DD' de Lima en el instante dado (Lima no tiene horario de verano). */
export function limaDateOf(instant: Date): string {
  return new Date(instant.getTime() + LIMA_SHIFT_MS).toISOString().slice(0, 10);
}

/** Suma `n` días (negativo resta) a una fecha 'YYYY-MM-DD'. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Franjas que el horario programa para el servicio en el día de Lima `date`. */
export function expectedSlots(serviceId: number, date: string, cfg: ScheduleConfig = DEFAULT_SCHEDULE): number {
  const { from, to } = limaDayBounds(date);
  let count = 0;
  let t = new Date(from.getTime() - 1);
  for (;;) {
    t = nextCycleAt(serviceId, t, cfg);
    if (t.getTime() >= to.getTime()) return count;
    count++;
  }
}
