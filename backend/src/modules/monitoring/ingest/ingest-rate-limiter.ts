import { Injectable } from '@nestjs/common';

/** Contrato de recepción: 600 lotes por minuto y por instalación. */
export const INGEST_WINDOW_MS = 60_000;
export const INGEST_MAX_BATCHES_PER_WINDOW = 600;

interface Window {
  start: number;
  count: number;
}

/**
 * Limitador de ritmo de la ingesta, por instalación y no por IP.
 *
 * Por instalación porque la clave es la identidad: varios servidores de una
 * granja salen por la misma IP, y una IP de NAT puede tener a varios clientes.
 * No se usa `@nestjs/throttler` porque cuenta antes de saber de quién es la
 * clave (va por `req.ip`) y porque aquí hace falta el `Retry-After` exacto,
 * que el appender respeta.
 *
 * Ventana fija y en memoria: un solo proceso de backend; si un día hay
 * varios, cada uno cuenta lo suyo y el tope efectivo se multiplica, que es
 * un fallo aceptable (protege de un bucle, no factura).
 *
 * El reloj entra por parámetro para probarlo sin temporizadores.
 */
@Injectable()
export class IngestRateLimiter {
  private readonly windows = new Map<number, Window>();
  private lastSweep = 0;

  take(installationId: number, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
    this.sweep(now);
    let w = this.windows.get(installationId);
    if (!w || now - w.start >= INGEST_WINDOW_MS) {
      w = { start: now, count: 0 };
      this.windows.set(installationId, w);
    }
    if (w.count >= INGEST_MAX_BATCHES_PER_WINDOW) {
      // Nunca 0: «Retry-After: 0» haría que el appender reintentara al instante.
      const retryAfterSec = Math.max(1, Math.ceil((w.start + INGEST_WINDOW_MS - now) / 1000));
      return { ok: false, retryAfterSec };
    }
    w.count += 1;
    return { ok: true };
  }

  /** Olvida las ventanas vencidas de vez en cuando: instalaciones dadas de baja no se acumulan. */
  private sweep(now: number): void {
    if (now - this.lastSweep < INGEST_WINDOW_MS) return;
    this.lastSweep = now;
    for (const [id, w] of this.windows) {
      if (now - w.start >= INGEST_WINDOW_MS) this.windows.delete(id);
    }
  }
}
