import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SCHEDULE,
  ProbeRunner,
  type CheckFn,
  type CheckResult,
  type ProbeSignal,
  type ServiceTarget,
} from '@kubo/monitoring-core';
import { CentralHttpError, type CentralApi, type ProbeBatch, type ProbeConfig, type SyncResponse, type CombinedStateRow } from '../src/central-client';
import { Engine } from '../src/engine';
import type { EngineConfig } from '../src/config';
import { Outbox } from '../src/outbox';
import { FakeClock } from './fake-clock';

const svc = (id: number): ServiceTarget => ({ id, protocol: 'TCP', target: `10.0.0.${id}`, port: 443, latencyThresholdMs: 1000 });

const engineConfig: EngineConfig = {
  centralUrl: 'https://central.test',
  probeCode: 'oficina-01',
  localPort: 0,
  syncIntervalMs: 15000,
};

const row = (serviceId: number): CombinedStateRow => ({
  serviceId,
  serverId: 10,
  clientId: 100,
  serviceName: `svc-${serviceId}`,
  serverName: 'srv',
  criticality: 'HIGH',
  office: { state: 'OK', lastCheckAt: '2026-11-23T14:55:37.000Z', lastLatencyMs: 20 },
  datacenter: { state: 'OK', lastCheckAt: '2026-11-23T14:55:10.000Z', lastLatencyMs: 5 },
  status: 'OK',
  incidentId: null,
  parentIncidentId: null,
  ticketCode: null,
});

class FakeCentral implements CentralApi {
  down = false;
  /** Solo falla el envío (p. ej. un 500 persistente), el sync responde. */
  batchDown = false;
  /** Ids que la central rechaza con 400 (validación). */
  readonly poison = new Set<string>();
  /** Tope de elementos por lote: por encima, 413. */
  maxItems = Infinity;
  sendAttempts = 0;
  configVersion = 'v1';
  config: ProbeConfig = { services: [svc(1)], schedule: DEFAULT_SCHEDULE, references: [] };
  orders: SyncResponse['orders'] = [];
  state: CombinedStateRow[] = [row(1)];
  readonly checks: CheckResult[] = [];
  readonly signals: ProbeSignal[] = [];
  readonly syncCalls: (string | null)[] = [];
  readonly batches: ProbeBatch[] = [];

  async sync(configVersion: string | null): Promise<SyncResponse> {
    if (this.down) throw new Error('connect ECONNREFUSED');
    this.syncCalls.push(configVersion);
    const orders = this.orders;
    this.orders = [];
    return {
      configVersion: this.configVersion,
      config: configVersion === this.configVersion ? null : this.config,
      orders,
      state: this.state,
    };
  }

  async sendBatch(batch: ProbeBatch) {
    this.sendAttempts++;
    if (this.down) throw new Error('connect ECONNREFUSED');
    if (this.batchDown) throw new CentralHttpError(500, null, 'HTTP 500', 'boom');
    if (batch.checks.length + batch.signals.length > this.maxItems) {
      throw new CentralHttpError(413, null, 'HTTP 413', '{"message":"request entity too large"}');
    }
    const bad = [...batch.checks, ...batch.signals].find((x) => this.poison.has(x.id));
    if (bad) throw new CentralHttpError(400, null, 'HTTP 400', `{"message":["${bad.id}: durationMs must be an integer"]}`);
    this.batches.push(batch);
    this.checks.push(...batch.checks);
    this.signals.push(...batch.signals);
    return { acceptedChecks: batch.checks.length, duplicateChecks: 0, acceptedSignals: batch.signals.length, duplicateSignals: 0 };
  }
}

/** Prueba falsa e instantánea; `ok(serviceId, kind)` decide el resultado. Guarda lo producido. */
function fakeCheck(ok: (serviceId: number, kind: string) => boolean) {
  const produced: CheckResult[] = [];
  const fn = jest.fn(async (target, kind, cycleAt, opts) => {
    const r: CheckResult = {
      id: randomUUID(),
      serviceId: target.id,
      kind,
      cycleAt: cycleAt.toISOString(),
      startedAt: (opts?.now?.() ?? new Date()).toISOString(),
      durationMs: 15,
      ok: ok(target.id, kind),
      errorCode: ok(target.id, kind) ? null : 'TIMEOUT',
      httpStatus: null,
      orderId: opts?.orderId ?? null,
    };
    produced.push(r);
    return r;
  }) as unknown as CheckFn & jest.Mock;
  return { fn, produced };
}

const START = '2026-11-23T15:00:00.000Z'; // 10:00 en Lima: franja de día, 5 min.

describe('Engine', () => {
  let dir: string;
  let outbox: Outbox;
  let clock: FakeClock;
  let central: FakeCentral;
  const engines: Engine[] = [];

  const make = (check: CheckFn, ob = outbox) => {
    const e = new Engine({ config: engineConfig, outbox: ob, central, clock, check, version: 'test' });
    engines.push(e);
    return e;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kubo-engine-'));
    outbox = new Outbox(join(dir, 'engine.db'));
    clock = new FakeClock(START);
    central = new FakeCentral();
  });

  afterEach(() => {
    for (const e of engines.splice(0)) e.stop();
    jest.restoreAllMocks();
    try {
      outbox.close();
    } catch {
      /* ya cerrada */
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('central caída en 3 sondeos → central.reachable false; los resultados se acumulan; al volver la central se vacía la cola y cada id llega una sola vez', async () => {
    const { fn, produced } = fakeCheck(() => true);
    const engine = make(fn);
    engine.start();
    await clock.advance(1);
    expect(engine.status().central.reachable).toBe(true);
    expect(engine.status().central.lastSyncAt).toBe(new Date(Date.parse(START)).toISOString());

    central.down = true;
    await clock.advance(15000);
    await clock.advance(15000);
    expect(engine.status().central.reachable).toBe(true);
    expect(engine.status().central.consecutiveFailures).toBe(2);
    await clock.advance(15000);
    expect(engine.status().central.reachable).toBe(false);
    expect(engine.status().central.consecutiveFailures).toBe(3);

    // Sigue midiendo y acumulando.
    await clock.advance(20 * 60_000);
    expect(produced.length).toBeGreaterThanOrEqual(4);
    expect(central.checks).toHaveLength(0);
    expect(engine.status().pending).toBe(produced.length);

    central.down = false;
    await clock.advance(15000);
    expect(engine.status().central.reachable).toBe(true);
    expect(engine.status().central.consecutiveFailures).toBe(0);
    expect(engine.status().pending).toBe(0);
    await clock.advance(60_000);
    const ids = central.checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(produced.map((c) => c.id)));
    for (const b of central.batches) expect(b.version).toBe('test');
  });

  it('con la central caída, services es el último estado recibido con el estado local superpuesto en la columna de oficina', async () => {
    const { fn } = fakeCheck(() => false);
    const engine = make(fn);
    engine.start();
    await clock.advance(1);
    expect(engine.status().services).toEqual([row(1)]);

    central.down = true;
    await clock.advance(45_000); // 3 sondeos fallidos; a los 37 s falla la regular → VERIFYING
    const st = engine.status();
    expect(st.central.reachable).toBe(false);
    expect(st.services).toHaveLength(1);
    expect(st.services[0].datacenter).toEqual(row(1).datacenter);
    expect(st.services[0].office).toEqual({ state: 'VERIFYING', lastCheckAt: '2026-11-23T15:00:37.000Z', lastLatencyMs: 20 });
  });

  it('tras reiniciar sin red, services es el último estado guardado con la oficina local superpuesta', async () => {
    const { fn } = fakeCheck(() => false);
    const e1 = make(fn);
    e1.start();
    await clock.advance(1);
    e1.stop();

    central.down = true;
    const e2 = make(fn);
    e2.start();
    expect(e2.status().services).toEqual([row(1)]);
    await clock.advance(45_000);
    const st = e2.status();
    expect(st.central.reachable).toBe(false);
    expect(st.central.lastSyncAt).toBeNull();
    expect(st.services[0].office!.state).toBe('VERIFYING');
  });

  it('config nueva en sync → updateServices con la lista nueva y se guarda en el Outbox', async () => {
    const update = jest.spyOn(ProbeRunner.prototype, 'updateServices');
    const { fn } = fakeCheck(() => true);
    const engine = make(fn);
    engine.start();
    await clock.advance(1);
    expect(JSON.parse(outbox.loadConfig()!.json).services).toEqual([svc(1)]);

    central.configVersion = 'v2';
    central.config = { ...central.config, services: [svc(1), svc(2)] };
    await clock.advance(15000);
    expect(central.syncCalls).toEqual([null, 'v1']);
    expect(update).toHaveBeenCalledWith([svc(1), svc(2)]);
    const saved = outbox.loadConfig()!;
    expect(saved.version).toBe('v2');
    expect(JSON.parse(saved.json)).toEqual(central.config);

    await clock.advance(15000);
    expect(central.syncCalls[2]).toBe('v2');
    expect(engine.status().services).toEqual([row(1)]);
  });

  it("orden CROSS → runNow(serviceId,'CROSS',orderId) y el resultado lleva orderId", async () => {
    const runNow = jest.spyOn(ProbeRunner.prototype, 'runNow');
    const { fn } = fakeCheck(() => true);
    const engine = make(fn);
    engine.start();
    await clock.advance(1);

    central.orders = [{ id: 77, serviceId: 1, kind: 'CROSS' }];
    await clock.advance(15000);
    expect(runNow).toHaveBeenCalledWith(1, 'CROSS', 77);
    await clock.advance(15000);
    const cross = central.checks.filter((c) => c.kind === 'CROSS');
    expect(cross).toHaveLength(1);
    expect(cross[0].orderId).toBe(77);
    expect(cross[0].serviceId).toBe(1);
    expect(engine.status().pending).toBe(0);
  });

  it('arranque sin red con config guardada → empieza a medir con ella', async () => {
    outbox.saveConfig('v1', JSON.stringify({ services: [svc(3)], schedule: DEFAULT_SCHEDULE, references: [] }));
    central.down = true;
    const { fn, produced } = fakeCheck(() => true);
    const engine = make(fn);
    engine.start();
    await clock.advance(6 * 60_000);
    expect(produced.length).toBeGreaterThanOrEqual(1);
    expect(produced.every((c) => c.serviceId === 3)).toBe(true);
    expect(engine.status().pending).toBe(produced.length);
    expect(engine.status().central.reachable).toBe(false);

    central.down = false;
    await clock.advance(15000);
    expect(central.syncCalls).toEqual(['v1']);
    expect(engine.status().pending).toBe(0);
  });

  it('reinicio a mitad de verificación: ningún CONFIRMED_FAILURE hasta tres fallos nuevos y los resultados previos se envían una sola vez', async () => {
    const file = join(dir, 'engine.db');
    const first = fakeCheck(() => false);
    const e1 = make(first.fn);
    e1.start();
    // Servicio 1: desfase 37 s → regular a las 15:00:37, falla → VERIFYING. Reintentos a +30/+60 s.
    await clock.advance(40_000);
    expect(first.produced).toHaveLength(1);
    expect(outbox.peekBatch(500).signals.map((s) => s.type)).toEqual(['VERIFYING']);
    e1.stop();
    outbox.close();

    // Otro motor sobre la misma base (reinicio del servicio).
    outbox = new Outbox(file);
    const second = fakeCheck(() => false);
    const e2 = make(second.fn, outbox);
    e2.start();

    const confirmed = () =>
      [...central.signals, ...outbox.peekBatch(100_000, 100_000).signals].filter((s) => s.type === 'CONFIRMED_FAILURE');
    for (let t = 0; t < 8 * 60_000; t += 5000) {
      await clock.advance(5000);
      if (confirmed().length > 0) expect(second.produced.length).toBeGreaterThanOrEqual(3);
    }
    expect(second.produced.length).toBeGreaterThanOrEqual(3);
    expect(confirmed()).toHaveLength(1);
    // El fallo de antes del reinicio no cuenta para la confirmación.
    expect(Date.parse(confirmed()[0].firstFailureAt!)).toBeGreaterThan(Date.parse('2026-11-23T15:00:40.000Z'));

    expect(e2.status().pending).toBe(0);
    const ids = central.checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(first.produced[0].id);
    const sigIds = central.signals.map((s) => s.id);
    expect(new Set(sigIds).size).toBe(sigIds.length);
    expect(central.signals[0].type).toBe('VERIFYING');
  });

  describe('un lote rechazado no detiene el motor', () => {
    const ck = (n: number): CheckResult => ({
      id: randomUUID(),
      serviceId: 1,
      kind: 'REGULAR',
      cycleAt: `2026-11-23T14:5${n}:37.000Z`,
      startedAt: `2026-11-23T14:5${n}:37.000Z`,
      durationMs: 10,
      ok: true,
      errorCode: null,
      httpStatus: null,
      orderId: null,
    });
    const sg = (n: number): ProbeSignal => ({
      id: randomUUID(),
      type: 'VERIFYING',
      serviceId: 1,
      at: `2026-11-23T14:5${n}:37.000Z`,
      firstFailureAt: `2026-11-23T14:5${n}:37.000Z`,
    });

    it('400 por un elemento: se biseca, ese elemento va a dead_letter y el resto llega en orden; el sync sigue', async () => {
      const c1 = ck(1);
      const s1 = sg(1);
      const c2 = ck(2);
      const c3 = ck(3);
      const s2 = sg(3);
      outbox.enqueueCheck(c1);
      outbox.enqueueSignal(s1);
      outbox.enqueueCheck(c2);
      outbox.enqueueCheck(c3);
      outbox.enqueueSignal(s2);
      central.poison.add(c2.id);

      const engine = make(fakeCheck(() => true).fn);
      engine.start();
      await clock.advance(1);

      expect(central.checks.map((c) => c.id)).toEqual([c1.id, c3.id]);
      expect(central.signals.map((s) => s.id)).toEqual([s1.id, s2.id]);
      // s1 (anterior a c2) sale antes que c3 (posterior): los lotes son prefijos.
      const firstWithC3 = central.batches.findIndex((b) => b.checks.some((c) => c.id === c3.id));
      const firstWithS1 = central.batches.findIndex((b) => b.signals.some((s) => s.id === s1.id));
      expect(firstWithS1).toBeLessThan(firstWithC3);

      const dead = outbox.deadLetters();
      expect(dead).toHaveLength(1);
      expect(dead[0]).toMatchObject({ kind: 'CHECK', id: c2.id, status: 400 });
      expect(dead[0].error).toContain('durationMs must be an integer');
      expect(JSON.parse(dead[0].payload)).toEqual(c2);

      expect(engine.status().pending).toBe(0);
      expect(central.syncCalls).toEqual([null]);
      expect(engine.status().central.consecutiveFailures).toBe(0);
    });

    it('413: se parte el lote hasta que cabe; todo llega en orden y nada va a dead_letter', async () => {
      const items = [ck(1), ck(2), ck(3), ck(4), ck(5)];
      for (const c of items) outbox.enqueueCheck(c);
      central.maxItems = 2;

      const engine = make(fakeCheck(() => true).fn);
      engine.start();
      await clock.advance(1);

      expect(central.checks.map((c) => c.id)).toEqual(items.map((c) => c.id));
      expect(outbox.deadLetters()).toEqual([]);
      expect(engine.status().pending).toBe(0);
      expect(central.syncCalls).toEqual([null]);
    });

    it('con el envío fallando siempre, el sync se hace en cada sondeo (config, órdenes y estado) y cuenta como fallo', async () => {
      const runNow = jest.spyOn(ProbeRunner.prototype, 'runNow');
      outbox.enqueueCheck(ck(1));
      central.batchDown = true;
      const engine = make(fakeCheck(() => true).fn);
      engine.start();
      await clock.advance(1);
      expect(central.syncCalls).toEqual([null]);
      expect(engine.status().services).toEqual([row(1)]);

      central.orders = [{ id: 5, serviceId: 1, kind: 'MANUAL' }];
      await clock.advance(15000);
      await clock.advance(15000);
      expect(central.syncCalls).toEqual([null, 'v1', 'v1']);
      expect(runNow).toHaveBeenCalledWith(1, 'MANUAL', 5);
      expect(engine.status().central.lastSyncAt).toBe('2026-11-23T15:00:30.000Z');
      expect(engine.status().central.consecutiveFailures).toBe(3);
      expect(engine.status().central.reachable).toBe(false);
    });
  });

  it('stop() y start() en la misma instancia reanudan la medición', async () => {
    const { fn, produced } = fakeCheck(() => true);
    const engine = make(fn);
    engine.start();
    await clock.advance(1);
    engine.stop();
    await clock.advance(60_000);
    const before = produced.length;

    engine.start();
    await clock.advance(6 * 60_000);
    expect(produced.length).toBeGreaterThan(before);
    expect(produced.some((c) => Date.parse(c.startedAt) > Date.parse('2026-11-23T15:01:00.001Z'))).toBe(true);
  });

  it('al sustituir el runner (cambia el horario) las pruebas de un servicio no se solapan entre el viejo y el nuevo', async () => {
    const active = new Map<number, number>();
    let maxActive = 0;
    const starts: { kind: string; at: number }[] = [];
    const slow = (async (target: ServiceTarget, kind: string, cycleAt: Date, opts?: { orderId?: number | null }) => {
      const n = (active.get(target.id) ?? 0) + 1;
      active.set(target.id, n);
      maxActive = Math.max(maxActive, n);
      starts.push({ kind, at: clock.now().getTime() });
      const startedAt = clock.now().toISOString();
      await clock.sleep(20_000);
      active.set(target.id, (active.get(target.id) ?? 1) - 1);
      return {
        id: randomUUID(),
        serviceId: target.id,
        kind,
        cycleAt: cycleAt.toISOString(),
        startedAt,
        durationMs: 20_000,
        ok: true,
        errorCode: null,
        httpStatus: null,
        orderId: opts?.orderId ?? null,
      } as CheckResult;
    }) as unknown as CheckFn;

    const engine = make(slow);
    engine.start();
    await clock.advance(40_000); // regular del servicio 1 a las 15:00:37, en vuelo hasta 15:00:57
    expect(active.get(1)).toBe(1);

    central.configVersion = 'v2';
    central.config = { ...central.config, schedule: { ...DEFAULT_SCHEDULE, nightIntervalMin: 2 } };
    central.orders = [{ id: 9, serviceId: 1, kind: 'MANUAL' }];
    await clock.advance(5_000); // sondeo de las 15:00:45: runner nuevo + orden MANUAL
    await clock.advance(60_000);

    expect(maxActive).toBe(1);
    const manual = starts.find((s) => s.kind === 'MANUAL');
    expect(manual).toBeDefined();
    expect(manual!.at).toBeGreaterThanOrEqual(Date.parse('2026-11-23T15:00:57.000Z'));
    expect(central.checks.some((c) => c.kind === 'MANUAL' && c.orderId === 9)).toBe(true);
  });
});
