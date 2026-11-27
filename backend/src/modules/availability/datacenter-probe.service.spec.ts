import { DatacenterProbeService } from './datacenter-probe.service';
import type { CheckResult, RunnerOptions } from './core';

const probe = { id: 3, code: 'kubo-01', kind: 'DATACENTER' } as any;
const svcRow = (id: number) => ({ id, protocol: 'TCP', target: '127.0.0.1', port: 9, latencyThresholdMs: 1500, status: 'ACTIVE' });
const result = (serviceId: number): CheckResult => ({
  id: 'u1', serviceId, kind: 'REGULAR', cycleAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 5, ok: false, errorCode: 'REFUSED', httpStatus: null, orderId: null,
});
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function setup(over: { probe?: any; orders?: any[]; affected?: number[] } = {}) {
  const runner = { start: jest.fn(), stop: jest.fn(), updateServices: jest.fn(), runNow: jest.fn() };
  let runnerOpts!: RunnerOptions;
  const probes = { findOneBy: jest.fn().mockResolvedValue('probe' in over ? over.probe : probe) };
  const services = { find: jest.fn().mockResolvedValue([svcRow(7)]) };
  const pending = over.orders ?? [];
  const orders = {
    find: jest.fn().mockImplementation(async () => pending.splice(0)),
    update: jest.fn().mockImplementation(async () => ({ affected: (over.affected ?? [1]).shift() ?? 1 })),
  };
  const ingest = { acceptBatch: jest.fn().mockResolvedValue({}) };
  class Testable extends DatacenterProbeService {
    protected createRunner(opts: RunnerOptions): any { runnerOpts = opts; return runner; }
  }
  const svc = new Testable(probes as any, services as any, orders as any, ingest as any);
  return { svc, runner, probes, services, orders, ingest, opts: () => runnerOpts };
}

describe('DatacenterProbeService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('arranca el runner sin referencias y sin degradación, con los servicios ACTIVE', async () => {
    const t = setup();
    await t.svc.onApplicationBootstrap();
    expect(t.probes.findOneBy).toHaveBeenCalledWith({ code: 'kubo-01' });
    expect(t.services.find).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
    expect(t.opts().references).toBeUndefined();
    expect(t.opts().tracker).toEqual({ trackDegradation: false });
    expect(t.opts().services).toEqual([{ id: 7, protocol: 'TCP', target: '127.0.0.1', port: 9, latencyThresholdMs: 1500 }]);
    expect(t.runner.start).toHaveBeenCalled();
    await t.svc.onApplicationShutdown();
  });

  it('falla con un mensaje claro si no existe la sonda kubo-01', async () => {
    const t = setup({ probe: null });
    await expect(t.svc.onApplicationBootstrap()).rejects.toThrow(/migración 035/);
  });

  it('entrega cada resultado a acceptBatch con la sonda kubo-01', async () => {
    const t = setup();
    await t.svc.onApplicationBootstrap();
    const r = result(7);
    t.opts().onResult(r, []);
    await flush();
    expect(t.ingest.acceptBatch).toHaveBeenCalledWith(probe, { checks: [r], signals: [], version: 'worker' }, expect.any(Date));
    await t.svc.onApplicationShutdown();
  });

  it('un fallo de acceptBatch no tumba el proceso y los siguientes resultados siguen entregándose', async () => {
    const t = setup();
    t.ingest.acceptBatch.mockRejectedValueOnce(new Error('db caída'));
    await t.svc.onApplicationBootstrap();
    t.opts().onResult(result(7), []);
    t.opts().onResult(result(7), []);
    await flush();
    expect(t.ingest.acceptBatch).toHaveBeenCalledTimes(2);
    await t.svc.onApplicationShutdown();
  });

  it('toma una orden MANUAL pendiente una sola vez y la ejecuta con su orderId', async () => {
    const t = setup({ orders: [{ id: 11, serviceId: 7, kind: 'MANUAL' }] });
    await t.svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.orders.find).toHaveBeenCalledWith({ where: { probeId: 3, kind: expect.anything(), takenAt: expect.anything() }, order: { id: 'ASC' } });
    expect(t.orders.update).toHaveBeenCalledWith({ id: 11, takenAt: expect.anything() }, { takenAt: expect.any(Date) });
    expect(t.runner.runNow).toHaveBeenCalledTimes(1);
    expect(t.runner.runNow).toHaveBeenCalledWith(7, 'MANUAL', 11);
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.runner.runNow).toHaveBeenCalledTimes(1);
    await t.svc.onApplicationShutdown();
  });

  it('una orden CROSS pendiente se toma una sola vez y se ejecuta con kind CROSS y su orderId', async () => {
    const t = setup({ orders: [{ id: 21, serviceId: 7, kind: 'CROSS' }] });
    await t.svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.orders.update).toHaveBeenCalledWith({ id: 21, takenAt: expect.anything() }, { takenAt: expect.any(Date) });
    expect(t.runner.runNow).toHaveBeenCalledTimes(1);
    expect(t.runner.runNow).toHaveBeenCalledWith(7, 'CROSS', 21);
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.runner.runNow).toHaveBeenCalledTimes(1);
    await t.svc.onApplicationShutdown();
  });

  it('una orden CROSS más vieja que el plazo del cruce (2 min) no se ejecuta: se marca tomada y hecha (el evaluador ya resolvió sin ella)', async () => {
    jest.setSystemTime(new Date('2026-11-23T15:10:00.000Z'));
    const t = setup({
      orders: [
        { id: 31, serviceId: 7, kind: 'CROSS', createdAt: new Date('2026-11-23T15:00:00.000Z') }, // 10 min: caducada
        { id: 32, serviceId: 7, kind: 'CROSS', createdAt: new Date('2026-11-23T15:09:30.000Z') }, // vigente
        { id: 33, serviceId: 7, kind: 'MANUAL', createdAt: new Date('2026-11-23T14:00:00.000Z') }, // MANUAL: siempre
      ],
    });
    await t.svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.orders.update).toHaveBeenCalledWith({ id: 31, takenAt: expect.anything() }, { takenAt: expect.any(Date), doneAt: expect.any(Date) });
    expect(t.runner.runNow).toHaveBeenCalledTimes(2);
    expect(t.runner.runNow).toHaveBeenCalledWith(7, 'CROSS', 32);
    expect(t.runner.runNow).toHaveBeenCalledWith(7, 'MANUAL', 33);
    expect(t.runner.runNow).not.toHaveBeenCalledWith(7, 'CROSS', 31);
    await t.svc.onApplicationShutdown();
  });

  it('consulta órdenes MANUAL y CROSS de kubo-01', async () => {
    const t = setup();
    await t.svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    const where = t.orders.find.mock.calls[0][0].where;
    expect(where.probeId).toBe(3);
    expect(where.kind._value).toEqual(['MANUAL', 'CROSS']);
    await t.svc.onApplicationShutdown();
  });

  it('no ejecuta una orden que otro proceso ya tomó (update afectó 0 filas)', async () => {
    const t = setup({ orders: [{ id: 12, serviceId: 7, kind: 'MANUAL' }], affected: [0] });
    await t.svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.runner.runNow).not.toHaveBeenCalled();
    await t.svc.onApplicationShutdown();
  });

  it('recarga los servicios cada 60 s con updateServices', async () => {
    const t = setup();
    await t.svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(60000);
    expect(t.runner.updateServices).toHaveBeenCalledTimes(1);
    await t.svc.onApplicationShutdown();
  });

  it('al apagar detiene el runner y los temporizadores', async () => {
    const t = setup();
    await t.svc.onApplicationBootstrap();
    await t.svc.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(20000);
    expect(t.runner.stop).toHaveBeenCalled();
    await t.svc.onApplicationShutdown();
    expect(t.orders.find).not.toHaveBeenCalled();
  });
});
