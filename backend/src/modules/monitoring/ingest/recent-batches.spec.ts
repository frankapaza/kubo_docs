import { RecentBatches, RECENT_BATCHES_MAX, RECENT_BATCHES_TTL_MS } from './recent-batches';

describe('RecentBatches', () => {
  const T0 = 1_800_000_000_000;
  const LOTE = '6f1c1c9e-6c39-4a4e-9a52-2f8f3f0e7a11';

  it('un loteId recordado se ve durante 15 min y deja de verse después', () => {
    const r = new RecentBatches();
    expect(r.seen(1, LOTE, T0)).toBe(false);
    r.remember(1, LOTE, T0);
    expect(r.seen(1, LOTE, T0 + 1)).toBe(true);
    expect(r.seen(1, LOTE, T0 + RECENT_BATCHES_TTL_MS - 1)).toBe(true);
    expect(r.seen(1, LOTE, T0 + RECENT_BATCHES_TTL_MS)).toBe(false);
  });

  it('el mismo loteId de otra instalación no cuenta como visto', () => {
    const r = new RecentBatches();
    r.remember(1, LOTE, T0);
    expect(r.seen(2, LOTE, T0)).toBe(false);
  });

  it(`no pasa de ${RECENT_BATCHES_MAX} entradas: tira las más viejas`, () => {
    const r = new RecentBatches();
    for (let i = 0; i < RECENT_BATCHES_MAX + 10; i++) r.remember(1, `l${i}`, T0 + i);
    expect(r.size).toBeLessThanOrEqual(RECENT_BATCHES_MAX);
    expect(r.seen(1, 'l0', T0 + RECENT_BATCHES_MAX + 10)).toBe(false);
    expect(r.seen(1, `l${RECENT_BATCHES_MAX + 9}`, T0 + RECENT_BATCHES_MAX + 10)).toBe(true);
  });

  it('claim reserva en un paso: el segundo ve pending, y tras remember ve done', () => {
    const r = new RecentBatches();
    expect(r.claim(1, LOTE, T0)).toBe('new');
    expect(r.claim(1, LOTE, T0)).toBe('pending');
    expect(r.seen(1, LOTE, T0)).toBe(false);
    r.remember(1, LOTE, T0);
    expect(r.claim(1, LOTE, T0)).toBe('done');
    expect(r.seen(1, LOTE, T0)).toBe(true);
  });

  it('forget suelta la reserva y el siguiente claim vuelve a ser new', () => {
    const r = new RecentBatches();
    r.claim(1, LOTE, T0);
    r.forget(1, LOTE);
    expect(r.claim(1, LOTE, T0)).toBe('new');
  });

  it('una reserva abandonada caduca con el mismo TTL', () => {
    const r = new RecentBatches();
    r.claim(1, LOTE, T0);
    expect(r.claim(1, LOTE, T0 + RECENT_BATCHES_TTL_MS)).toBe('new');
  });
});
