import { Injectable } from '@nestjs/common';

/** Cuánto se recuerda un lote: de sobra para los reintentos con espera creciente del appender. */
export const RECENT_BATCHES_TTL_MS = 15 * 60 * 1000;
/** Tope de memoria: a 600 lotes/min por instalación, cubre de sobra el tráfico real. */
export const RECENT_BATCHES_MAX = 50_000;

interface Entry {
  expiresAt: number;
  /** Reservado por una petición en vuelo, aún sin confirmar. */
  pending: boolean;
}

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
  private readonly entries = new Map<string, Entry>();

  /** Para las pruebas del tope. */
  get size(): number {
    return this.entries.size;
  }

  /** ¿Sus errores ya quedaron registrados? (un lote solo reservado no cuenta) */
  seen(installationId: number, loteId: string, now: number): boolean {
    return this.state(installationId, loteId, now) === 'done';
  }

  /**
   * Mira y reserva en un solo paso síncrono: dos peticiones con el mismo lote
   * no pueden obtener las dos 'new', porque entre mirar y marcar no hay await.
   * 'new' = esta petición registra los errores; 'pending' = otra lo está
   * haciendo ahora; 'done' = ya se registraron.
   */
  claim(installationId: number, loteId: string, now: number): 'new' | 'pending' | 'done' {
    const st = this.state(installationId, loteId, now);
    if (st !== null) return st;
    this.put(this.key(installationId, loteId), { expiresAt: now + RECENT_BATCHES_TTL_MS, pending: true }, now);
    return 'new';
  }

  /** Confirma el lote: sus errores quedaron registrados. */
  remember(installationId: number, loteId: string, now: number): void {
    this.put(this.key(installationId, loteId), { expiresAt: now + RECENT_BATCHES_TTL_MS, pending: false }, now);
  }

  /** Suelta una reserva cuyo registro falló: el reintento debe volver a registrar. */
  forget(installationId: number, loteId: string): void {
    this.entries.delete(this.key(installationId, loteId));
  }

  private state(installationId: number, loteId: string, now: number): 'pending' | 'done' | null {
    const k = this.key(installationId, loteId);
    const e = this.entries.get(k);
    if (e === undefined) return null;
    if (e.expiresAt <= now) {
      this.entries.delete(k);
      return null;
    }
    return e.pending ? 'pending' : 'done';
  }

  private put(k: string, entry: Entry, now: number): void {
    // Borrar antes de poner lo lleva al final del orden: es ahora el más nuevo.
    this.entries.delete(k);
    this.purgeExpired(now);
    while (this.entries.size >= RECENT_BATCHES_MAX) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    this.entries.set(k, entry);
  }

  /** Las vencidas están al principio (TTL fijo + orden de inserción): se para en la primera viva. */
  private purgeExpired(now: number): void {
    for (const [k, e] of this.entries) {
      if (e.expiresAt > now) break;
      this.entries.delete(k);
    }
  }

  /** El separador no puede aparecer en el id numérico: no hay choques entre instalaciones. */
  private key(installationId: number, loteId: string): string {
    return `${installationId}:${loteId}`;
  }
}
