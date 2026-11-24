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
  const evaluator = { tick: jest.fn().mockResolvedValue(undefined) };
  class Testable extends DatacenterProbeService {
    protected createRunner(opts: RunnerOptions): any { runnerOpts = opts; return runner; }
  }
  const svc = new Testable(probes as any, services as any, orders as any, ingest as any, { get: () => evaluator } as any);
  return { svc, runner, probes, services, orders, ingest, evaluator, opts: () => runnerOpts };
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
    await expect(t.svc.onApplicationBootstrap()).rejects.toThrow(/migración 031/);
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

  it('crossCheck(7) y request(7) piden runNow(7, CROSS, null)', async () => {
    const t = setup();
    await t.svc.onApplicationBootstrap();
    t.svc.crossCheck(7);
    t.svc.request(7);
    expect(t.runner.runNow).toHaveBeenNthCalledWith(1, 7, 'CROSS', null);
    expect(t.runner.runNow).toHaveBeenNthCalledWith(2, 7, 'CROSS', null);
    await t.svc.onApplicationShutdown();
  });

  it('toma una orden MANUAL pendiente una sola vez y la ejecuta con su orderId', async () => {
    const t = setup({ orders: [{ id: 11, serviceId: 7, kind: 'MANUAL' }] });
    await t.svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.orders.find).toHaveBeenCalledWith({ where: { probeId: 3, kind: 'MANUAL', takenAt: expect.anything() }, order: { id: 'ASC' } });
    expect(t.orders.update).toHaveBeenCalledWith({ id: 11, takenAt: expect.anything() }, { takenAt: expect.any(Date) });
    expect(t.runner.runNow).toHaveBeenCalledTimes(1);
    expect(t.runner.runNow).toHaveBeenCalledWith(7, 'MANUAL', 11);
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.runner.runNow).toHaveBeenCalledTimes(1);
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

  it('el tick corre cada 5 s y un tick lento hace que el siguiente se salte', async () => {
    const t = setup();
    let release!: () => void;
    t.evaluator.tick.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    await t.svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.evaluator.tick).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10000); // dos ciclos con el primero aún en curso
    expect(t.evaluator.tick).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(5000);
    expect(t.evaluator.tick).toHaveBeenCalledTimes(2);
    await t.svc.onApplicationShutdown();
  });

  it('una excepción del tick se registra y el siguiente tick se ejecuta', async () => {
    const t = setup();
    t.evaluator.tick.mockRejectedValueOnce(new Error('boom'));
    await t.svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10000);
    expect(t.evaluator.tick).toHaveBeenCalledTimes(2);
    await t.svc.onApplicationShutdown();
  });

  it('al apagar detiene el runner y los temporizadores', async () => {
    const t = setup();
    await t.svc.onApplicationBootstrap();
    await t.svc.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(20000);
    expect(t.runner.stop).toHaveBeenCalled();
    expect(t.evaluator.tick).not.toHaveBeenCalled();
  });
});

describe('DatacenterProbeService: cableado en Nest', () => {
  it('el evaluador recibe la sonda como DatacenterCrossChecker sin ciclo de dependencias (que colgaría el arranque)', async () => {
    const { Test } = await import('@nestjs/testing');
    const { getRepositoryToken } = await import('@nestjs/typeorm');
    const { DataSource } = await import('typeorm');
    const { AvailabilityEvaluatorService } = await import('./availability-evaluator.service');
    const { AvailabilityTicketsService } = await import('./availability-tickets.service');
    const { AvailabilityIngestService } = await import('./availability-ingest.service');
    const { DatacenterCrossChecker } = await import('./datacenter-cross-checker');
    const { MonitorProbe } = await import('./entities/monitor-probe.entity');
    const { MonitorService } = await import('./entities/monitor-service.entity');
    const { MonitorProbeOrder } = await import('./entities/monitor-probe-order.entity');
    const moduleRef = await Test.createTestingModule({
      providers: [
        DatacenterProbeService,
        AvailabilityEvaluatorService,
        { provide: DatacenterCrossChecker, useExisting: DatacenterProbeService },
        { provide: DataSource, useValue: { manager: {}, transaction: jest.fn() } },
        { provide: AvailabilityTicketsService, useValue: {} },
        { provide: AvailabilityIngestService, useValue: {} },
        { provide: getRepositoryToken(MonitorProbe), useValue: {} },
        { provide: getRepositoryToken(MonitorService), useValue: {} },
        { provide: getRepositoryToken(MonitorProbeOrder), useValue: {} },
      ],
    }).compile();
    expect(moduleRef.get(DatacenterCrossChecker)).toBe(moduleRef.get(DatacenterProbeService));
    expect((moduleRef.get(AvailabilityEvaluatorService) as any).crossChecker).toBe(moduleRef.get(DatacenterProbeService));
  });
});
