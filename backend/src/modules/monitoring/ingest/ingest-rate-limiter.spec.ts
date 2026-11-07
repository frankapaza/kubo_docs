import { IngestRateLimiter, INGEST_MAX_BATCHES_PER_WINDOW, INGEST_WINDOW_MS } from './ingest-rate-limiter';

describe('IngestRateLimiter', () => {
  const T0 = 1_800_000_000_000;

  it('deja pasar 600 lotes por minuto y el 601 recibe retryAfterSec > 0', () => {
    const l = new IngestRateLimiter();
    for (let i = 0; i < INGEST_MAX_BATCHES_PER_WINDOW; i++) {
      expect(l.take(1, T0 + i)).toEqual({ ok: true });
    }
    const r = l.take(1, T0 + 30_000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryAfterSec).toBeGreaterThan(0);
      // Lo que falta para que acabe la ventana, redondeado hacia arriba.
      expect(r.retryAfterSec).toBe(30);
    }
  });

  it('otra instalación no se ve afectada', () => {
    const l = new IngestRateLimiter();
    for (let i = 0; i < INGEST_MAX_BATCHES_PER_WINDOW; i++) l.take(1, T0);
    expect(l.take(1, T0).ok).toBe(false);
    expect(l.take(2, T0)).toEqual({ ok: true });
  });

  it('la ventana siguiente vuelve a dejar pasar', () => {
    const l = new IngestRateLimiter();
    for (let i = 0; i < INGEST_MAX_BATCHES_PER_WINDOW; i++) l.take(1, T0);
    expect(l.take(1, T0 + INGEST_WINDOW_MS - 1).ok).toBe(false);
    expect(l.take(1, T0 + INGEST_WINDOW_MS)).toEqual({ ok: true });
  });

  it('retryAfterSec nunca es 0 aunque falte menos de un segundo', () => {
    const l = new IngestRateLimiter();
    for (let i = 0; i < INGEST_MAX_BATCHES_PER_WINDOW; i++) l.take(1, T0);
    const r = l.take(1, T0 + INGEST_WINDOW_MS - 10);
    expect(r).toEqual({ ok: false, retryAfterSec: 1 });
  });
});
