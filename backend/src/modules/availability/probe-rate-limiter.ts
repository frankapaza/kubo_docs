import { Injectable } from '@nestjs/common';

/** Contrato de la sonda: 60 lotes por minuto y por sonda. */
export const PROBE_WINDOW_MS = 60_000;
export const PROBE_MAX_BATCHES_PER_WINDOW = 60;

interface Window {
  start: number;
  count: number;
}

/**
 * Limitador de `POST /ingest/probe/batch`, por sonda y no por IP (la oficina
 * y otras sondas pueden compartir salida). Mismo criterio que
 * `IngestRateLimiter` de logs —ventana fija en memoria, un solo proceso— y por
 * el mismo motivo no usa `@nestjs/throttler`, que cuenta por `req.ip`. Va
 * DESPUÉS de `ProbeTokenGuard`: solo cuenta quien ya se identificó.
 */
@Injectable()
export class ProbeRateLimiter {
  private readonly windows = new Map<number, Window>();
  private lastSweep = 0;

  take(probeId: number, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
    this.sweep(now);
    let w = this.windows.get(probeId);
    if (!w || now - w.start >= PROBE_WINDOW_MS) {
      w = { start: now, count: 0 };
      this.windows.set(probeId, w);
    }
    if (w.count >= PROBE_MAX_BATCHES_PER_WINDOW) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.start + PROBE_WINDOW_MS - now) / 1000)) };
    }
    w.count += 1;
    return { ok: true };
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < PROBE_WINDOW_MS) return;
    this.lastSweep = now;
    for (const [id, w] of this.windows) {
      if (now - w.start >= PROBE_WINDOW_MS) this.windows.delete(id);
    }
  }
}
