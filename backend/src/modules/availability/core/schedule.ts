// GENERADO — no editar; fuente: packages/monitoring-core/src
// Regenerar con: node scripts/sync-monitoring-core.mjs

import type { ScheduleConfig } from './types';

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  dayStartHour: 7,
  nightStartHour: 22,
  dayIntervalMin: 5,
  nightIntervalMin: 1,
};

/** Lima es UTC-5 todo el año (sin horario de verano). */
export const LIMA_OFFSET_MINUTES = -300;

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;

/** Milisegundos desde la medianoche de Lima; nunca usa la zona del proceso. */
function limaMsOfDay(instant: Date): number {
  const limaMs = instant.getTime() + LIMA_OFFSET_MINUTES * MIN_MS;
  return ((limaMs % DAY_MS) + DAY_MS) % DAY_MS;
}

/** Intervalo vigente en el instante dado, según la hora de Lima. */
export function intervalMsAt(instant: Date, cfg: ScheduleConfig): number {
  const hour = limaMsOfDay(instant) / (60 * MIN_MS);
  const isDay = hour >= cfg.dayStartHour && hour < cfg.nightStartHour;
  return (isDay ? cfg.dayIntervalMin : cfg.nightIntervalMin) * MIN_MS;
}

/** Desfase fijo por servicio (0-59 s) para no lanzar todos a la vez. */
export function serviceOffsetMs(serviceId: number): number {
  return ((serviceId * 37) % 60) * 1000;
}

/**
 * Primer instante estrictamente posterior a `after` alineado al reloj de Lima
 * (franja de día o de noche) más el desfase del servicio.
 * Supone que los límites de franja caen en múltiplos del intervalo de día.
 */
export function nextCycleAt(serviceId: number, after: Date, cfg: ScheduleConfig): Date {
  const offset = serviceOffsetMs(serviceId);
  // Franja base: primer múltiplo del intervalo vigente, estrictamente > base.
  const base = new Date(after.getTime() - offset);
  const interval = intervalMsAt(base, cfg);
  const limaShift = LIMA_OFFSET_MINUTES * MIN_MS;
  const limaMs = base.getTime() + limaShift;
  const slotLimaMs = (Math.floor(limaMs / interval) + 1) * interval;
  return new Date(slotLimaMs - limaShift + offset);
}

/** Lanza un Error (en español) si la configuración de franjas no es coherente. */
export function assertValidSchedule(cfg: ScheduleConfig): void {
  const day = 24 * 60;
  for (const [name, v] of [['dayIntervalMin', cfg.dayIntervalMin], ['nightIntervalMin', cfg.nightIntervalMin]] as const) {
    if (!Number.isInteger(v) || v <= 0 || day % v !== 0) {
      throw new Error(`Configuración de horario inválida: ${name} (${v}) debe ser un entero positivo que divida 1440 minutos.`);
    }
  }
  for (const [name, v] of [['dayStartHour', cfg.dayStartHour], ['nightStartHour', cfg.nightStartHour]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 23) {
      throw new Error(`Configuración de horario inválida: ${name} (${v}) debe estar entre 0 y 23.`);
    }
  }
  if (cfg.dayStartHour >= cfg.nightStartHour) {
    throw new Error('Configuración de horario inválida: dayStartHour debe ser menor que nightStartHour.');
  }
  for (const boundary of [cfg.dayStartHour * 60, cfg.nightStartHour * 60]) {
    if (boundary % cfg.dayIntervalMin !== 0 || boundary % cfg.nightIntervalMin !== 0) {
      throw new Error(`Configuración de horario inválida: el límite de franja (${boundary} min) debe ser múltiplo de ambos intervalos.`);
    }
  }
}
