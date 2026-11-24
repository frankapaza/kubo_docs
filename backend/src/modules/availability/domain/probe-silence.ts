/** Una sonda que no reporta durante este tiempo se considera callada. */
export const PROBE_SILENCE_MS = 600_000;

export type SilenceDecision = 'ALERT' | 'RECOVERED' | 'NONE';

export interface SilenceProbeView {
  lastSeenAt: Date | null;
  silenceAlertedAt: Date | null;
}

/**
 * Decide si hay que avisar del silencio de una sonda. Una sonda que nunca
 * reportó (`lastSeenAt` nulo) no alerta: es el caso de la oficina cuyo token
 * aún no se ha configurado.
 */
export function silenceDecision(p: SilenceProbeView, now: Date): SilenceDecision {
  if (p.silenceAlertedAt) {
    return p.lastSeenAt && p.lastSeenAt.getTime() > p.silenceAlertedAt.getTime() ? 'RECOVERED' : 'NONE';
  }
  if (!p.lastSeenAt) return 'NONE';
  return now.getTime() - p.lastSeenAt.getTime() >= PROBE_SILENCE_MS ? 'ALERT' : 'NONE';
}
