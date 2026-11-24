// GENERADO — no editar; fuente: packages/monitoring-core/src
// Regenerar con: node scripts/sync-monitoring-core.mjs

import { randomUUID } from 'crypto';
import type { CheckResult, ServiceTarget } from './types';

export type SignalType =
  | 'VERIFYING'
  | 'CONFIRMED_FAILURE'
  | 'TRANSIENT_FAILURE'
  | 'RECOVERED'
  | 'DEGRADED'
  | 'DEGRADATION_CLEARED'
  | 'OFFICE_OUTAGE_START'
  | 'OFFICE_OUTAGE_END';

export interface ProbeSignal {
  /** UUID propio de la señal: la central deduplica por él. */
  id: string;
  type: SignalType;
  serviceId: number | null;
  /** ISO del resultado que produjo la señal. */
  at: string;
  /** ISO del primer fallo. Se informa en VERIFYING y CONFIRMED_FAILURE; null en el resto. */
  firstFailureAt: string | null;
}

export interface TrackerOptions {
  retryOffsetsMs: [number, number];
  recoveryOkCount: number;
  degradationCycles: number;
  degradationClearOkCount: number;
  trackDegradation: boolean;
}

export const DEFAULT_TRACKER: TrackerOptions = {
  retryOffsetsMs: [30000, 60000],
  recoveryOkCount: 2,
  degradationCycles: 3,
  degradationClearOkCount: 2,
  trackDegradation: true,
};

export type TrackerState = 'OK' | 'VERIFYING' | 'FAILED' | 'DEGRADED';

/**
 * Invariantes: cada DEGRADED va seguido de exactamente un DEGRADATION_CLEARED, y cada
 * CONFIRMED_FAILURE de exactamente un RECOVERED, antes del siguiente de su tipo.
 * Contrato: mientras está en VERIFYING solo los resultados RETRY hacen avanzar el
 * estado; el runner debe entregar siempre ambos reintentos.
 */
export class ServiceProbeTracker {
  private readonly opts: TrackerOptions;
  private st: TrackerState = 'OK';
  private firstFailureAt: string | null = null;
  private failedRetries = 0;
  private okStreak = 0;
  private slowStreak = 0;
  private fastStreak = 0;

  constructor(private readonly service: ServiceTarget, opts: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKER, ...opts };
  }

  state(): TrackerState {
    return this.st;
  }

  pendingRetryAt(): Date | null {
    if (this.st !== 'VERIFYING' || this.firstFailureAt === null) return null;
    const offset = this.opts.retryOffsetsMs[this.failedRetries];
    if (offset === undefined) return null;
    return new Date(Date.parse(this.firstFailureAt) + offset);
  }

  onResult(r: CheckResult): ProbeSignal[] {
    const sig = (type: SignalType, firstFailureAt: string | null = null): ProbeSignal => ({
      id: randomUUID(),
      type,
      serviceId: this.service.id,
      at: r.startedAt,
      firstFailureAt,
    });

    if (this.st === 'VERIFYING') {
      if (r.kind !== 'RETRY') return [];
      if (r.ok) {
        this.st = 'OK';
        this.resetAll();
        return [sig('TRANSIENT_FAILURE')];
      }
      this.failedRetries++;
      if (this.failedRetries >= this.opts.retryOffsetsMs.length) {
        this.st = 'FAILED';
        this.okStreak = 0;
        return [sig('CONFIRMED_FAILURE', this.firstFailureAt)];
      }
      return [];
    }

    if (this.st === 'FAILED') {
      if (!r.ok) {
        this.okStreak = 0;
        return [];
      }
      this.okStreak++;
      if (this.okStreak >= this.opts.recoveryOkCount) {
        this.st = 'OK';
        this.resetAll();
        return [sig('RECOVERED')];
      }
      return [];
    }

    // OK o DEGRADED
    if (!r.ok) {
      if (r.kind !== 'REGULAR') return [];
      const wasDegraded = this.st === 'DEGRADED';
      this.st = 'VERIFYING';
      this.firstFailureAt = r.startedAt;
      this.failedRetries = 0;
      this.slowStreak = 0;
      this.fastStreak = 0;
      // Salir de DEGRADED cierra el incidente de degradación: CLEARED va antes que VERIFYING.
      return wasDegraded
        ? [sig('DEGRADATION_CLEARED'), sig('VERIFYING', this.firstFailureAt)]
        : [sig('VERIFYING', this.firstFailureAt)];
    }
    if (!this.opts.trackDegradation || r.kind !== 'REGULAR') return [];
    const slow = r.durationMs > this.service.latencyThresholdMs;
    if (this.st === 'OK') {
      this.slowStreak = slow ? this.slowStreak + 1 : 0;
      if (this.slowStreak >= this.opts.degradationCycles) {
        this.st = 'DEGRADED';
        this.slowStreak = 0;
        this.fastStreak = 0;
        return [sig('DEGRADED')];
      }
      return [];
    }
    this.fastStreak = slow ? 0 : this.fastStreak + 1;
    if (this.fastStreak >= this.opts.degradationClearOkCount) {
      this.st = 'OK';
      this.slowStreak = 0;
      this.fastStreak = 0;
      return [sig('DEGRADATION_CLEARED')];
    }
    return [];
  }

  private resetAll(): void {
    this.firstFailureAt = null;
    this.failedRetries = 0;
    this.okStreak = 0;
    this.slowStreak = 0;
    this.fastStreak = 0;
  }
}
