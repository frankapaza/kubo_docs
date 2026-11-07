import { DiskWatchService } from './disk-watch.service';

function build(env: { path?: string; pct?: string } = {}) {
  const saved = { p: process.env.LOKI_DATA_PATH, t: process.env.LOKI_DISK_ALERT_PCT };
  process.env.LOKI_DATA_PATH = env.path ?? '/loki-data';
  process.env.LOKI_DISK_ALERT_PCT = env.pct ?? '80';
  const gateway = { notifyDiskAlert: jest.fn() };
  const svc = new DiskWatchService(gateway as never);
  // La configuración se lee al construir: se restaura para no contaminar otras pruebas.
  if (saved.p === undefined) delete process.env.LOKI_DATA_PATH;
  else process.env.LOKI_DATA_PATH = saved.p;
  if (saved.t === undefined) delete process.env.LOKI_DISK_ALERT_PCT;
  else process.env.LOKI_DISK_ALERT_PCT = saved.t;
  // `statfs` sustituido: la prueba no depende del disco de quien la corre.
  const stat = jest.spyOn(svc as never, 'readStatfs' as never) as jest.SpyInstance;
  const usePct = (pct: number) => stat.mockResolvedValue({ blocks: 100, bavail: 100 - pct });
  return { svc, gateway, stat, usePct };
}

describe('DiskWatchService', () => {
  it('85 % con umbral 80 alerta una sola vez aunque se compruebe tres veces', async () => {
    const { svc, gateway, usePct } = build();
    usePct(85);
    await svc.check();
    await svc.check();
    const s = await svc.check();
    expect(s).toMatchObject({ path: '/loki-data', usedPct: 85, threshold: 80, alert: true });
    expect(s.checkedAt).not.toBeNull();
    expect(gateway.notifyDiskAlert).toHaveBeenCalledTimes(1);
    expect(gateway.notifyDiskAlert).toHaveBeenCalledWith({ usedPct: 85, threshold: 80 });
  });

  it('al bajar a 70 % y volver a 85 % avisa otra vez', async () => {
    const { svc, gateway, usePct } = build();
    usePct(85);
    await svc.check();
    usePct(70);
    const low = await svc.check();
    expect(low.alert).toBe(false);
    usePct(85);
    await svc.check();
    expect(gateway.notifyDiskAlert).toHaveBeenCalledTimes(2);
  });

  it('una ruta inexistente (desarrollo) da usedPct null, sin alerta y sin lanzar', async () => {
    const { svc, gateway, stat } = build();
    stat.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    const s = await svc.check();
    expect(s).toMatchObject({ usedPct: null, alert: false });
    expect(gateway.notifyDiskAlert).not.toHaveBeenCalled();
  });

  it('status() antes de comprobar nada: sin dato', () => {
    const { svc } = build();
    expect(svc.status()).toEqual({ path: '/loki-data', usedPct: null, threshold: 80, alert: false, checkedAt: null });
  });
});
