import type { Clock } from '../src/clock';

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
}

/** Espera a que se vacíe la cola de microtareas (promesas encadenadas incluidas). */
export const flushPromises = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Reloj manual. `advance(ms)` ejecuta en orden temporal (y por orden de alta en
 * caso de empate) los temporizadores vencidos, vaciando las promesas pendientes
 * entre uno y otro, de modo que las cadenas `then` reaccionan en el instante
 * simulado correcto.
 */
export class FakeClock implements Clock {
  private t: number;
  private seq = 0;
  private readonly timers = new Map<number, Timer>();

  constructor(start: Date | string) {
    this.t = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.t);
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), seq: id, fn });
    return id;
  }

  clearTimeout(h: unknown): void {
    this.timers.delete(h as number);
  }

  /** Resuelve tras `ms` de tiempo simulado; útil como duración de una prueba falsa. */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }

  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await flushPromises();
    for (;;) {
      let next: [number, Timer] | null = null;
      for (const entry of this.timers) {
        const tm = entry[1];
        if (tm.at > end) continue;
        if (!next || tm.at < next[1].at || (tm.at === next[1].at && tm.seq < next[1].seq)) next = entry;
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
      await flushPromises();
    }
    this.t = end;
    await flushPromises();
  }
}
