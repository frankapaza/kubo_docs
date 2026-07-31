import { BadRequestException } from '@nestjs/common';
import { TicketPriority } from './ticket-priority';

export interface SlaTargets {
  responseMinutes: number;
  resolutionMinutes: number;
}

export type SlaMatrix = Record<TicketPriority, SlaTargets>;

/** Semilla de la política «Estándar» (spec §2.3). */
export const DEFAULT_SLA_MATRIX: SlaMatrix = {
  P1: { responseMinutes: 15, resolutionMinutes: 240 },
  P2: { responseMinutes: 30, resolutionMinutes: 360 },
  P3: { responseMinutes: 60, resolutionMinutes: 720 },
  P4: { responseMinutes: 240, resolutionMinutes: 1440 },
};

/** Fracción del plazo de resolución a partir de la cual el ticket se marca en riesgo. */
export const AT_RISK_THRESHOLD = 0.7;

const MINUTE_MS = 60 * 1000;

/**
 * Vencimientos absolutos a partir de la creación. Horas corridas 24x7:
 * en T1 no existe calendario laboral ni horario de cobertura.
 */
export function computeDueDates(
  createdAt: Date,
  priority: TicketPriority,
  matrix: SlaMatrix,
): { responseDueAt: Date; resolutionDueAt: Date } {
  const targets = matrix[priority];
  return {
    responseDueAt: new Date(createdAt.getTime() + targets.responseMinutes * MINUTE_MS),
    resolutionDueAt: new Date(createdAt.getTime() + targets.resolutionMinutes * MINUTE_MS),
  };
}

/**
 * Al salir de ESPERA_CLIENTE se desplazan los vencimientos por lo que duró la pausa.
 * Se mueven las fechas absolutas en vez de recalcularlas en cada lectura, para que
 * la consulta de vencidos siga siendo un WHERE sobre una columna indexada.
 */
export function shiftForPause(input: {
  pausedAt: Date;
  resumedAt: Date;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
}): { pausedSeconds: number; responseDueAt: Date | null; resolutionDueAt: Date | null } {
  const deltaMs = input.resumedAt.getTime() - input.pausedAt.getTime();
  if (deltaMs < 0) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'La reanudación no puede ser anterior a la pausa.',
    });
  }
  return {
    pausedSeconds: Math.round(deltaMs / 1000),
    responseDueAt: input.responseDueAt ? new Date(input.responseDueAt.getTime() + deltaMs) : null,
    resolutionDueAt: input.resolutionDueAt
      ? new Date(input.resolutionDueAt.getTime() + deltaMs)
      : null,
  };
}

export interface SlaClockState {
  now: Date;
  createdAt: Date;
  resolutionDueAt: Date;
  pausedTotalSeconds: number;
  /** No nulo mientras el ticket está en ESPERA_CLIENTE. */
  pausedAt: Date | null;
}

/**
 * Fracción del plazo de resolución ya consumida, descontando el tiempo en pausa
 * (el acumulado y el de la pausa en curso, si la hay).
 */
export function consumedRatio(state: SlaClockState): number {
  const pausedMs = state.pausedTotalSeconds * 1000;
  const ongoingPauseMs = state.pausedAt ? state.now.getTime() - state.pausedAt.getTime() : 0;

  const activeMs = state.now.getTime() - state.createdAt.getTime() - pausedMs - ongoingPauseMs;
  // El plazo original: la fecha de vencimiento ya incorpora los desplazamientos por pausa.
  const windowMs = state.resolutionDueAt.getTime() - state.createdAt.getTime() - pausedMs;

  if (windowMs <= 0) return 1;
  return activeMs / windowMs;
}

export function isAtRisk(state: SlaClockState): boolean {
  return consumedRatio(state) >= AT_RISK_THRESHOLD;
}
