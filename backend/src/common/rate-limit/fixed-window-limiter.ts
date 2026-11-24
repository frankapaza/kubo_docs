interface Window {
  start: number;
  count: number;
}

export type TakeResult = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Limitador de ventana fija y en memoria, por identidad (no por IP).
 *
 * Salió de `IngestRateLimiter` cuando el conector de Claude necesitó lo mismo
 * con otro tope: la ingesta lo extiende con sus constantes. Un solo proceso de
 * backend; con varios, cada uno cuenta lo suyo (aceptable: protege de un
 * bucle, no factura). El reloj entra por parámetro para probarlo sin
 * temporizadores.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<number, Window>();
  private lastSweep = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  take(id: number, now: number): TakeResult {
    this.sweep(now);
    let w = this.windows.get(id);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(id, w);
    }
    if (w.count >= this.max) {
      // Nunca 0: «Retry-After: 0» invita a reintentar al instante.
      const retryAfterSec = Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000));
      return { ok: false, retryAfterSec };
    }
    w.count += 1;
    return { ok: true };
  }

  /** Olvida las ventanas vencidas de vez en cuando: identidades dadas de baja no se acumulan. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [id, w] of this.windows) {
      if (now - w.start >= this.windowMs) this.windows.delete(id);
    }
  }
}
