import type { Tone } from '../shared/widget-model';

/**
 * Copia de `STATUS_COLORS` de web/src/pages/availability/availability-ui.ts (mismos colores que
 * la web). Si cambian allí, actualizar aquí.
 */
export const STATUS_COLORS = {
  OK: { bg: '#e6f4ea', fg: '#1e7a3c' },
  VERIFYING: { bg: '#fff4e0', fg: '#a35c00' },
  DEGRADED: { bg: '#fff4e0', fg: '#a35c00' },
  DOWN: { bg: '#fdecea', fg: '#b3261e' },
  ROUTE: { bg: '#fdecea', fg: '#b3261e' },
  NO_DATA: { bg: '#eef0f1', fg: '#6d7577' },
} as const;

export const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  ok: STATUS_COLORS.OK,
  red: STATUS_COLORS.DOWN,
  amber: STATUS_COLORS.VERIFYING,
  grey: STATUS_COLORS.NO_DATA,
};
