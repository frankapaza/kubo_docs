import { Injectable } from '@nestjs/common';

/** Contrato del agente: una muestra cada 60 s; menos de 20 s entre dos es un error del agente. */
export const AGENT_MIN_INTERVAL_MS = 20_000;
const SWEEP_EVERY_MS = 10 * 60_000;

/**
 * Limitador de `POST /ingest/probe/agent/samples`, por servidor (no por IP).
 * Mismo criterio que `ProbeRateLimiter`: en memoria, un solo proceso. Va
 * después de `AgentTokenGuard`.
 */
@Injectable()
export class AgentRateLimiter {
  private readonly last = new Map<number, number>();
  private lastSweep = 0;

  take(serverId: number, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
    this.sweep(now);
    const prev = this.last.get(serverId);
    if (prev !== undefined && now - prev < AGENT_MIN_INTERVAL_MS) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((prev + AGENT_MIN_INTERVAL_MS - now) / 1000)) };
    }
    this.last.set(serverId, now);
    return { ok: true };
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [id, at] of this.last) if (now - at >= AGENT_MIN_INTERVAL_MS) this.last.delete(id);
  }
}
