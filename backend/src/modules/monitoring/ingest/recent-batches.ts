import { Injectable } from '@nestjs/common';

/** Cuánto se recuerda un lote: de sobra para los reintentos con espera creciente del appender. */
export const RECENT_BATCHES_TTL_MS = 15 * 60 * 1000;
/** Tope de memoria: a 600 lotes/min por instalación, cubre de sobra el tráfico real. */
export const RECENT_BATCHES_MAX = 50_000;

/**
 * Lotes (instalación + `loteId`) cuyos errores ya se registraron.
 *
 * Review Focus 1: cuando Loki responde 503 el appender reintenta el MISMO
 * lote. Sin esto, cada reintento volvería a sumar las mismas ocurrencias y a
 * publicarlas en vivo. Con esto, el reintento solo reintenta Loki (que ya
 * deduplica por ts+línea dentro del stream).
 *
 * En memoria y no en MySQL: perderlo en un reinicio solo cuesta, como mucho,
 * contar dos veces un lote reintentado justo entonces; guardarlo en la base
 * sería una escritura más por lote para cubrir un caso rarísimo.
 *
 * El `Map` conserva el orden de inserción, así que la primera clave es la
 * más vieja: al llegar al tope se tira por delante sin recorrer nada.
 */
@Injectable()
export class RecentBatches {
  private readonly entries = new Map<string, number>();

  /** Para las pruebas del tope. */
  get size(): number {
    return this.entries.size;
  }

  seen(installationId: number, loteId: string, now: number): boolean {
    const k = this.key(installationId, loteId);
    const expiresAt = this.entries.get(k);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.entries.delete(k);
      return false;
    }
    return true;
  }

  remember(installationId: number, loteId: string, now: number): void {
    const k = this.key(installationId, loteId);
    // Borrar antes de poner lo lleva al final del orden: es ahora el más nuevo.
    this.entries.delete(k);
    this.purgeExpired(now);
    while (this.entries.size >= RECENT_BATCHES_MAX) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    this.entries.set(k, now + RECENT_BATCHES_TTL_MS);
  }

  /** Las vencidas están al principio (TTL fijo + orden de inserción): se para en la primera viva. */
  private purgeExpired(now: number): void {
    for (const [k, expiresAt] of this.entries) {
      if (expiresAt > now) break;
      this.entries.delete(k);
    }
  }

  /** El separador no puede aparecer en el id numérico: no hay choques entre instalaciones. */
  private key(installationId: number, loteId: string): string {
    return `${installationId}:${loteId}`;
  }
}
