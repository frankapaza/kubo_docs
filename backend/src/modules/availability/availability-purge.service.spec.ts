import { AvailabilityPurgeService } from './availability-purge.service';

// El doble de repositorio responde a `query` (DELETE ... LIMIT) con el afectado de cada lote.
const repo = (table: string, batches: number[]) =>
  ({
    metadata: { tableName: table },
    query: jest.fn().mockImplementation(async () => ({ affectedRows: batches.shift() ?? 0 })),
  }) as any;

describe('AvailabilityPurgeService', () => {
  it('borra en lotes de 5000 hasta que un lote devuelve menos (5000, 5000, 12 → 3 lotes)', async () => {
    const c = repo('monitor_checks', [5000, 5000, 12]);
    const svc = new AvailabilityPurgeService(c, repo('monitor_probe_signals', [0]));
    const r = await svc.purge(new Date('2026-06-01T00:00:00Z'));
    expect(c.query).toHaveBeenCalledTimes(3);
    expect(c.query.mock.calls[0][0]).toBe('DELETE FROM `monitor_checks` WHERE started_at < ? LIMIT 5000');
    expect(r).toEqual({ checks: 10012, signals: 0 });
  });

  it('corta en el primer lote vacío y purga también las señales procesadas', async () => {
    const c = repo('monitor_checks', [0]);
    const s = repo('monitor_probe_signals', [5000, 3]);
    const svc = new AvailabilityPurgeService(c, s);
    const r = await svc.purge(new Date());
    expect(c.query).toHaveBeenCalledTimes(1);
    expect(s.query).toHaveBeenCalledTimes(2);
    expect(s.query.mock.calls[0][0]).toBe(
      'DELETE FROM `monitor_probe_signals` WHERE processed_at IS NOT NULL AND received_at < ? LIMIT 5000',
    );
    expect(r).toEqual({ checks: 0, signals: 5003 });
  });

  it('el límite de antigüedad es now - 90 días', async () => {
    const c = repo('monitor_checks', [0]);
    const svc = new AvailabilityPurgeService(c, repo('monitor_probe_signals', [0]));
    await svc.purge(new Date('2026-06-01T00:00:00Z'));
    expect((c.query.mock.calls[0][1][0] as Date).toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });

  it('la tarea programada no lanza si la base falla', async () => {
    const c = repo('monitor_checks', []);
    c.query.mockRejectedValue(new Error('db'));
    const svc = new AvailabilityPurgeService(c, repo('monitor_probe_signals', []));
    await expect(svc.run()).resolves.toBeUndefined();
  });
});
