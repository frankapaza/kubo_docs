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
import { CentralHttpError, type CentralApi, type ProbeBatch, type ProbeConfig, type SyncResponse, type CombinedStateRow, type ServerAlert } from '../src/central-client';
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
  /** Rechaza todo lote con 400 (p. ej. contrato roto tras un despliegue). */
  rejectAll = false;
  sendAttempts = 0;
  configVersion = 'v1';
  config: ProbeConfig = { services: [svc(1)], schedule: DEFAULT_SCHEDULE, references: [] };
  orders: SyncResponse['orders'] = [];
  state: CombinedStateRow[] = [row(1)];
  /** undefined = central vieja, sin el campo. */
  serverAlerts: ServerAlert[] | undefined = undefined;
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
      ...(this.serverAlerts === undefined ? {} : { serverAlerts: this.serverAlerts }),
    };
  }

  async sendBatch(batch: ProbeBatch) {
    this.sendAttempts++;
    if (this.down) throw new Error('connect ECONNREFUSED');
    if (this.batchDown) throw new CentralHttpError(500, null, 'HTTP 500', 'boom');
    if (batch.checks.length + batch.signals.length > this.maxItems) {
      throw new CentralHttpError(413, null, 'HTTP 413', '{"message":"request entity too large"}');
    }
    if (this.rejectAll) throw new CentralHttpError(400, null, 'HTTP 400', '{"message":["property foo should not exist"]}');
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
    // Cola = las comprobaciones + la STATE_SYNC de arranque del servicio 1.
    expect(engine.status().pending).toBe(produced.length + 1);
    expect(outbox.peekBatch(100_000, 100_000).signals.map((x) => x.type)).toEqual(['STATE_SYNC']);

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
    const queued = outbox.peekBatch(100_000, 100_000);
    expect(queued.checks).toHaveLength(produced.length);
    expect(engine.status().pending).toBe(produced.length + queued.signals.length);
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
      // El tamaño reducido se conserva tras un envío aceptado: 5✕, 3✕, 2✓, 2✓, 1✓.
      expect(central.sendAttempts).toBe(5);
    });

    it('si la central rechaza todo (400), como mucho 3 van a dead_letter: se abre el corte, el resto queda en cola y el sondeo falla; al aceptar de nuevo se cierra y se vacía', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ck(i));
      for (const c of items) outbox.enqueueCheck(c);
      central.rejectAll = true;
      const errors: string[] = [];
      const measured = fakeCheck(() => true);
      const engine = new Engine({
        config: engineConfig,
        outbox,
        central,
        clock,
        check: measured.fn,
        version: 'test',
        logger: { info: () => undefined, warn: () => undefined, error: (m) => errors.push(m) },
      });
      engines.push(engine);
      engine.start();
      await clock.advance(1);
      await clock.advance(15000);
      await clock.advance(15000);

      expect(outbox.deadLetters().map((d) => d.id)).toEqual(items.slice(0, 3).map((c) => c.id));
      // Lo medido mientras tanto (regular de las 15:00:37) también espera en cola.
      expect(engine.status().pending).toBe(7 + measured.produced.length);
      expect(engine.status().central.rejecting).toBe(true);
      expect(engine.status().central.consecutiveFailures).toBeGreaterThanOrEqual(1);
      expect(central.syncCalls.length).toBe(3); // el sync sigue

      // Con el corte abierto: un solo envío de un elemento por sondeo y una sola línea ERROR.
      const attempts = central.sendAttempts;
      const errs = errors.length;
      await clock.advance(15000);
      expect(central.sendAttempts - attempts).toBe(1);
      expect(errors.length - errs).toBe(1);
      expect(outbox.deadLetters()).toHaveLength(3);
      expect(engine.status().pending).toBe(7 + measured.produced.length);
      // Un solo CENTRAL_REJECTING (con aviso) por la apertura del corte.
      const rejecting = engine.events(0, 500).events.filter((e) => e.kind === 'CENTRAL_REJECTING');
      expect(rejecting).toHaveLength(1);
      expect(rejecting[0].notify).toBe(true);

      central.rejectAll = false;
      await clock.advance(15000);
      expect(engine.status().central.rejecting).toBe(false);
      expect(engine.status().central.consecutiveFailures).toBe(0);
      expect(engine.status().pending).toBe(0);
      expect(central.checks.map((c) => c.id)).toEqual([...items.slice(3), ...measured.produced].map((c) => c.id));
      expect(outbox.deadLetters()).toHaveLength(3);
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

  it('reinicio con el servicio FAILED que se recupera mientras el motor estaba parado: el motor nuevo emite STATE_SYNC', async () => {
    const file = join(dir, 'engine.db');
    const first = fakeCheck(() => false);
    const e1 = make(first.fn);
    e1.start();
    await clock.advance(2 * 60_000); // regular 15:00:37 + reintentos a +30/+60 s → CONFIRMED_FAILURE
    expect([...central.signals, ...outbox.peekBatch(500).signals].map((x) => x.type)).toEqual(['VERIFYING', 'CONFIRMED_FAILURE']);
    e1.stop();
    outbox.close();

    // El servicio vuelve mientras el motor está parado; el tracker nuevo no sabe que estaba FAILED.
    outbox = new Outbox(file);
    const second = fakeCheck(() => true);
    const e2 = make(second.fn, outbox);
    e2.start();
    await clock.advance(11 * 60_000); // dos franjas de 5 min
    const types = central.signals.map((x) => x.type);
    expect(types).toEqual(['VERIFYING', 'CONFIRMED_FAILURE', 'STATE_SYNC']);
    expect(central.signals[2].serviceId).toBe(1);
  });

  it('sustitución del runner durante una caída de oficina que termina antes de la primera franja del nuevo: llega OFFICE_OUTAGE_END', async () => {
    let internet = false;
    central.config = { services: [svc(1), svc(2)], schedule: DEFAULT_SCHEDULE, references: [svc(1001), svc(1002)] };
    const { fn } = fakeCheck(() => internet);
    const engine = make(fn);
    engine.start();
    await clock.advance(11 * 60_000);
    expect(engine.status().officeOutage).toBe(true);
    expect(central.signals.filter((x) => x.type.startsWith('OFFICE')).map((x) => x.type)).toEqual(['OFFICE_OUTAGE_START']);

    // Cambia el horario (runner nuevo) y vuelve internet.
    internet = true;
    central.configVersion = 'v2';
    central.config = { ...central.config, schedule: { ...DEFAULT_SCHEDULE, dayIntervalMin: 10 } };
    await clock.advance(25 * 60_000);
    expect(engine.status().officeOutage).toBe(false);
    expect(central.signals.filter((x) => x.type.startsWith('OFFICE')).map((x) => x.type)).toEqual([
      'OFFICE_OUTAGE_START',
      'OFFICE_OUTAGE_END',
    ]);
  });

  it('sustitución del runner con la caída de oficina en curso: el runner nuevo vuelve a declarar START (idempotente en la central)', async () => {
    central.config = { services: [svc(1), svc(2)], schedule: DEFAULT_SCHEDULE, references: [svc(1001)] };
    const { fn } = fakeCheck(() => false);
    const engine = make(fn);
    engine.start();
    await clock.advance(11 * 60_000);
    central.configVersion = 'v2';
    central.config = { ...central.config, schedule: { ...DEFAULT_SCHEDULE, dayIntervalMin: 10 } };
    await clock.advance(25 * 60_000);
    expect(engine.status().officeOutage).toBe(true);
    const office = central.signals.filter((x) => x.type.startsWith('OFFICE')).map((x) => x.type);
    expect(office).toEqual(['OFFICE_OUTAGE_START', 'OFFICE_OUTAGE_START']);
  });

  describe('diario de eventos', () => {
    const kinds = (e: Engine) => e.events(0, 500).events.map((x) => x.kind);

    it('status incluye centralUrl de la configuración', async () => {
      const engine = make(fakeCheck(() => true).fn);
      engine.start();
      await clock.advance(1);
      expect(engine.status().centralUrl).toBe('https://central.test');
    });

    it('el primer estado tras arrancar no genera eventos; un incidente nuevo en un sync → INCIDENT_OPENED', async () => {
      central.state = [{ ...row(1), status: 'DOWN', incidentId: 5 }];
      const engine = make(fakeCheck(() => true).fn);
      engine.start();
      await clock.advance(1);
      expect(kinds(engine)).toEqual([]);
      central.state = [{ ...row(1), status: 'DOWN', incidentId: 5 }, { ...row(2), status: 'ROUTE', incidentId: 6 }];
      await clock.advance(15000);
      const evs = engine.events(0, 500).events;
      expect(evs.map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_OPENED', 6, true]]);
      expect(evs[0].at).toBe('2026-11-23T15:00:15.000Z');
    });

    it('central caída con un incidente abierto: el estado local cambia y no hay RECOVERED; al volver con el incidente cerrado, un RECOVERED y un CENTRAL_BACK', async () => {
      let ok = false;
      const engine = make(fakeCheck(() => ok).fn);
      engine.start();
      await clock.advance(1);
      central.state = [{ ...row(1), status: 'DOWN', incidentId: 5 }];
      await clock.advance(15000);
      expect(kinds(engine)).toEqual(['INCIDENT_OPENED']);

      central.down = true;
      await clock.advance(45_000);
      expect(engine.status().central.reachable).toBe(false);
      expect(kinds(engine)).toEqual(['INCIDENT_OPENED', 'CENTRAL_UNREACHABLE']);
      // Mientras tanto, la oficina vuelve a ver el servicio sano (estado local superpuesto).
      ok = true;
      await clock.advance(10 * 60_000);
      expect(engine.status().services[0].office?.state).toBe('OK');
      expect(kinds(engine)).toEqual(['INCIDENT_OPENED', 'CENTRAL_UNREACHABLE']);

      central.state = [row(1)];
      central.down = false;
      await clock.advance(15000);
      const evs = engine.events(0, 500).events;
      expect(evs.map((e) => e.kind)).toEqual(['INCIDENT_OPENED', 'CENTRAL_UNREACHABLE', 'INCIDENT_RECOVERED', 'CENTRAL_BACK']);
      expect(evs.find((e) => e.kind === 'CENTRAL_UNREACHABLE')?.notify).toBe(true);
      expect(evs.find((e) => e.kind === 'CENTRAL_BACK')?.notify).toBe(false);
      expect(evs.find((e) => e.kind === 'INCIDENT_RECOVERED')).toMatchObject({ incidentKey: 5, notify: true });

      // Más sondeos sin cambios: nada nuevo.
      await clock.advance(60_000);
      expect(engine.events(0, 500).events).toHaveLength(4);
    });

    it('caída de oficina → un OFFICE_OUTAGE_STARTED (aunque el runner se sustituya y repita START) y al terminar un OFFICE_OUTAGE_ENDED', async () => {
      let internet = false;
      central.config = { services: [svc(1), svc(2)], schedule: DEFAULT_SCHEDULE, references: [svc(1001)] };
      const engine = make(fakeCheck(() => internet).fn);
      engine.start();
      await clock.advance(11 * 60_000);
      expect(engine.status().officeOutage).toBe(true);
      expect(kinds(engine)).toEqual(['OFFICE_OUTAGE_STARTED']);

      // Runner nuevo con la caída en curso: vuelve a declarar START; el diario no se repite.
      central.configVersion = 'v2';
      central.config = { ...central.config, schedule: { ...DEFAULT_SCHEDULE, dayIntervalMin: 10 } };
      await clock.advance(25 * 60_000);
      expect(central.signals.filter((x) => x.type === 'OFFICE_OUTAGE_START')).toHaveLength(2);
      expect(kinds(engine)).toEqual(['OFFICE_OUTAGE_STARTED']);

      internet = true;
      await clock.advance(25 * 60_000);
      expect(engine.status().officeOutage).toBe(false);
      const evs = engine.events(0, 500).events;
      expect(evs.map((e) => [e.kind, e.notify])).toEqual([
        ['OFFICE_OUTAGE_STARTED', true],
        // Un aviso por corte: el regreso queda solo en el historial.
        ['OFFICE_OUTAGE_ENDED', false],
      ]);
    });

    it('los eventos se guardan en la base del Outbox y sobreviven a un reinicio', async () => {
      const engine = make(fakeCheck(() => true).fn);
      engine.start();
      await clock.advance(1);
      central.state = [{ ...row(1), status: 'DOWN', incidentId: 5 }];
      await clock.advance(15000);
      engine.stop();
      outbox.close();
      outbox = new Outbox(join(dir, 'engine.db'));
      const e2 = make(fakeCheck(() => true).fn, outbox);
      expect(e2.events(0, 10)).toEqual({ lastId: 1, events: [expect.objectContaining({ id: 1, kind: 'INCIDENT_OPENED' })] });
    });

    it('tras reiniciar, el primer sync se compara con el último estado fresco guardado: el incidente cerrado mientras tanto → un RECOVERED', async () => {
      outbox.saveState(JSON.stringify([{ ...row(1), status: 'DOWN', incidentId: 5 }]));
      central.state = [row(1)];
      const engine = make(fakeCheck(() => true).fn);
      engine.start();
      await clock.advance(1);
      const evs = engine.events(0, 10).events;
      expect(evs.map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_RECOVERED', 5, true]]);
    });

    it('el corte por rechazo no produce un falso CENTRAL_UNREACHABLE (el sync responde) ni un CENTRAL_BACK al cerrarse', async () => {
      for (let i = 0; i < 10; i++) {
        outbox.enqueueCheck({
          id: randomUUID(),
          serviceId: 1,
          kind: 'REGULAR',
          cycleAt: START,
          startedAt: START,
          durationMs: 10,
          ok: true,
          errorCode: null,
          httpStatus: null,
          orderId: null,
        });
      }
      central.rejectAll = true;
      const engine = make(fakeCheck(() => true).fn);
      engine.start();
      await clock.advance(1);
      await clock.advance(6 * 15000);
      expect(engine.status().central.rejecting).toBe(true);
      expect(engine.status().central.consecutiveFailures).toBeGreaterThanOrEqual(3);
      // El sync responde: la central no está «caída», solo rechaza (el widget debe decir «rechaza»).
      expect(engine.status().central.reachable).toBe(true);
      expect(kinds(engine)).toEqual(['CENTRAL_REJECTING']);
      central.rejectAll = false;
      await clock.advance(15000);
      expect(engine.status().central.rejecting).toBe(false);
      expect(kinds(engine)).toEqual(['CENTRAL_REJECTING']);
    });

    it('con el corte abierto, un error real aislado no anota CENTRAL_UNREACHABLE; tres seguidos sí', async () => {
      for (let i = 0; i < 10; i++) {
        outbox.enqueueCheck({
          id: randomUUID(),
          serviceId: 1,
          kind: 'REGULAR',
          cycleAt: START,
          startedAt: START,
          durationMs: 10,
          ok: true,
          errorCode: null,
          httpStatus: null,
          orderId: null,
        });
      }
      central.rejectAll = true;
      const engine = make(fakeCheck(() => true).fn);
      engine.start();
      await clock.advance(1);
      await clock.advance(6 * 15000);
      expect(engine.status().central.consecutiveFailures).toBeGreaterThanOrEqual(3);
      expect(kinds(engine)).toEqual(['CENTRAL_REJECTING']);

      central.down = true; // un sondeo con error real
      await clock.advance(15000);
      central.down = false;
      await clock.advance(15000);
      expect(kinds(engine)).toEqual(['CENTRAL_REJECTING']);

      central.down = true; // tres seguidos
      await clock.advance(2 * 15000);
      expect(kinds(engine)).toEqual(['CENTRAL_REJECTING']);
      await clock.advance(15000);
      expect(kinds(engine)).toEqual(['CENTRAL_REJECTING', 'CENTRAL_UNREACHABLE']);
      central.down = false;
      await clock.advance(15000);
      expect(kinds(engine)).toEqual(['CENTRAL_REJECTING', 'CENTRAL_UNREACHABLE', 'CENTRAL_BACK']);
    });

    it('tras sustituir el runner con la caída de oficina en curso, status().officeOutage sigue en true hasta que el runner nuevo da veredicto', async () => {
      let internet = false;
      central.config = { services: [svc(1), svc(2)], schedule: DEFAULT_SCHEDULE, references: [svc(1001)] };
      const engine = make(fakeCheck(() => internet).fn);
      engine.start();
      await clock.advance(11 * 60_000);
      expect(engine.status().officeOutage).toBe(true);
      central.configVersion = 'v2';
      central.config = { ...central.config, schedule: { ...DEFAULT_SCHEDULE, dayIntervalMin: 10 } };
      await clock.advance(15000); // sync con la config nueva: runner nuevo, sin veredicto aún
      expect(central.syncCalls).toContain('v1');
      expect(engine.status().officeOutage).toBe(true);
      internet = true;
      await clock.advance(25 * 60_000);
      expect(engine.status().officeOutage).toBe(false);
      expect(kinds(engine)).toEqual(['OFFICE_OUTAGE_STARTED', 'OFFICE_OUTAGE_ENDED']);
    });

    describe('un corte, un aviso (CENTRAL_UNREACHABLE se decide con el veredicto de oficina)', () => {
      const officeCfg = (): ProbeConfig => ({ services: [svc(1), svc(2)], schedule: DEFAULT_SCHEDULE, references: [svc(1001)] });
      const pairs = (e: Engine) => e.events(0, 500).events.map((x) => [x.kind, x.notify]);
      const notified = (e: Engine) => e.events(0, 500).events.filter((x) => x.notify).map((x) => x.kind);

      it('internet de la oficina cae a mitad de franja (referencias y destinos fallan y el sync falla): un solo aviso, OFFICE_OUTAGE_STARTED', async () => {
        let internet = true;
        central.config = officeCfg();
        const engine = make(fakeCheck(() => internet).fn);
        engine.start();
        await clock.advance(7 * 60_000 + 5_000); // 15:07:05, a mitad de la franja de las 15:05
        expect(kinds(engine)).toEqual([]);
        internet = false;
        central.down = true;
        await clock.advance(60_000); // 3 sondeos fallidos: «no responde», pero el aviso queda pendiente
        expect(engine.status().central.reachable).toBe(false);
        expect(kinds(engine)).toEqual([]);
        await clock.advance(15 * 60_000);
        expect(engine.status().officeOutage).toBe(true);
        expect(pairs(engine)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['CENTRAL_UNREACHABLE', false],
        ]);

        internet = true;
        central.down = false;
        await clock.advance(15 * 60_000);
        expect(engine.status().officeOutage).toBe(false);
        expect(pairs(engine)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['CENTRAL_UNREACHABLE', false],
          ['CENTRAL_BACK', false],
          ['OFFICE_OUTAGE_ENDED', false],
        ]);
        expect(notified(engine)).toEqual(['OFFICE_OUTAGE_STARTED']);
      });

      it('la franja en curso al caer internet (referencias medidas antes del corte) no decide aunque se juzgue después del umbral', async () => {
        let internet = true;
        // Desfases: servicio 2 a +14 s, 1 a +37 s, 3 a +51 s: la franja de las 15:10 se juzga a las 15:10:51.
        central.config = { ...officeCfg(), services: [svc(1), svc(2), svc(3)] };
        const engine = make(fakeCheck(() => internet).fn);
        engine.start();
        await clock.advance(10 * 60_000 + 1_000); // 15:10:01: referencias de las 15:10 ya medidas, bien
        internet = false;
        central.down = true;
        await clock.advance(60_000); // umbral a las 15:10:45; veredicto «sin caída» de las 15:10 a las 15:10:51
        expect(kinds(engine)).toEqual([]);
        await clock.advance(6 * 60_000); // la franja de las 15:15 se juzga a las 15:15:51: caída
        expect(pairs(engine)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['CENTRAL_UNREACHABLE', false],
        ]);
      });

      it('todo falla desde el arranque (config guardada): un solo aviso, OFFICE_OUTAGE_STARTED', async () => {
        outbox.saveConfig('v1', JSON.stringify(officeCfg()));
        central.config = officeCfg();
        central.down = true;
        const engine = make(fakeCheck(() => false).fn);
        engine.start();
        // El runner abre su primera franja a las 15:05 y la juzga a las 15:05:37 (START): se decide en ese momento, sin esperar al plazo (15:12).
        await clock.advance(6 * 60_000);
        expect(pairs(engine)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['CENTRAL_UNREACHABLE', false],
        ]);
        await clock.advance(10 * 60_000);
        expect(pairs(engine)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['CENTRAL_UNREACHABLE', false],
        ]);
      });

      it('la central cae con internet de la oficina bien: un CENTRAL_UNREACHABLE con aviso tras el veredicto de la primera franja posterior al fallo', async () => {
        central.config = officeCfg();
        const engine = make(fakeCheck(() => true).fn);
        engine.start();
        await clock.advance(7 * 60_000 + 5_000);
        central.down = true;
        await clock.advance(60_000); // 15:08:05
        expect(engine.status().central.reachable).toBe(false);
        expect(kinds(engine)).toEqual([]);
        // La franja de las 15:05 (juzgada antes del fallo) no decide; la de las 15:10 sí (≈15:10:37).
        await clock.advance(2 * 60_000); // 15:10:05
        expect(kinds(engine)).toEqual([]);
        await clock.advance(60_000); // 15:11:05
        expect(pairs(engine)).toEqual([['CENTRAL_UNREACHABLE', true]]);
        await clock.advance(10 * 60_000);
        expect(pairs(engine)).toEqual([['CENTRAL_UNREACHABLE', true]]);
        central.down = false;
        await clock.advance(15_000);
        expect(pairs(engine)).toEqual([
          ['CENTRAL_UNREACHABLE', true],
          ['CENTRAL_BACK', false],
        ]);
      });

      it('la central vuelve antes de decidir: no se anota nada', async () => {
        central.config = officeCfg();
        const engine = make(fakeCheck(() => true).fn);
        engine.start();
        await clock.advance(7 * 60_000 + 5_000);
        central.down = true;
        await clock.advance(60_000);
        expect(engine.status().central.reachable).toBe(false);
        central.down = false;
        await clock.advance(15_000);
        expect(engine.status().central.reachable).toBe(true);
        await clock.advance(10 * 60_000);
        expect(kinds(engine)).toEqual([]);
      });

      it('sin veredicto de oficina (las referencias no terminan): decide con aviso 2 min después del fin de la primera franja posterior al fallo', async () => {
        let refsHang = false;
        const base = fakeCheck(() => true).fn;
        const fn = ((t, k, c, o) => (refsHang && t.id >= 1000 ? new Promise(() => undefined) : base(t, k, c, o))) as CheckFn;
        central.config = officeCfg();
        const engine = make(fn);
        engine.start();
        await clock.advance(7 * 60_000 + 5_000);
        refsHang = true;
        central.down = true; // primer sondeo fallido a las 15:07:15 → franja de las 15:10, que acaba a las 15:15
        await clock.advance(9 * 60_000); // 15:16:05
        expect(kinds(engine)).toEqual([]);
        await clock.advance(60_000); // 15:17:05: pasado el plazo (15:17:00)
        expect(pairs(engine)).toEqual([['CENTRAL_UNREACHABLE', true]]);
      });

      it('sin referencias configuradas no hay veredicto que esperar: avisa al tercer sondeo fallido', async () => {
        const engine = make(fakeCheck(() => true).fn);
        engine.start();
        await clock.advance(1);
        central.down = true;
        await clock.advance(45_000);
        expect(pairs(engine)).toEqual([['CENTRAL_UNREACHABLE', true]]);
      });

      it('con la caída de oficina ya anotada, CENTRAL_UNREACHABLE va solo al historial en cuanto se alcanza el umbral', async () => {
        let internet = false;
        central.config = officeCfg();
        const engine = make(fakeCheck(() => internet).fn);
        engine.start();
        await clock.advance(11 * 60_000);
        expect(pairs(engine)).toEqual([['OFFICE_OUTAGE_STARTED', true]]);
        central.down = true;
        await clock.advance(45_000);
        expect(pairs(engine)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['CENTRAL_UNREACHABLE', false],
        ]);

        // Vuelve internet pero la central sigue caída: ahora sí es la central → un aviso tras el siguiente veredicto.
        internet = true;
        await clock.advance(12 * 60_000);
        expect(pairs(engine)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['CENTRAL_UNREACHABLE', false],
          ['OFFICE_OUTAGE_ENDED', false],
          ['CENTRAL_UNREACHABLE', true],
        ]);
        central.down = false;
        await clock.advance(15_000);
        expect(notified(engine)).toEqual(['OFFICE_OUTAGE_STARTED', 'CENTRAL_UNREACHABLE']);
        expect(kinds(engine).slice(-1)).toEqual(['CENTRAL_BACK']);
      });
    });

    describe('alertas de servidor y mantenimiento', () => {
      const disk = (detail = 'C: 9 % libre'): ServerAlert => ({ serverId: 10, serverName: 'srv', kind: 'DISK_LOW', detail });
      const alertEvents = (e: Engine) =>
        e.events(0, 500).events.map((x) => [x.kind, x.serverId, x.alertKind, x.detail, x.notify]);
      const reopen = (e: Engine) => {
        e.stop();
        outbox.close();
        outbox = new Outbox(join(dir, 'engine.db'));
      };

      it('primer arranque: las alertas ya activas no avisan; una nueva → STARTED; al irse → CLEARED; status las incluye', async () => {
        central.serverAlerts = [disk()];
        const engine = make(fakeCheck(() => true).fn);
        engine.start();
        await clock.advance(1);
        expect(alertEvents(engine)).toEqual([]);
        expect(engine.status().serverAlerts).toEqual([disk()]);
        const silentAlert: ServerAlert = { serverId: 11, serverName: 'srv-2', kind: 'AGENT_SILENT', detail: 'sin datos desde 14:32' };
        central.serverAlerts = [disk('C: 8 % libre'), silentAlert];
        await clock.advance(15000);
        expect(alertEvents(engine)).toEqual([['SERVER_ALERT_STARTED', 11, 'AGENT_SILENT', 'sin datos desde 14:32', false]]);
        expect(engine.status().serverAlerts).toEqual([disk('C: 8 % libre'), silentAlert]);
        central.serverAlerts = [];
        await clock.advance(15000);
        expect(alertEvents(engine).slice(1)).toEqual([
          ['SERVER_ALERT_CLEARED', 10, 'DISK_LOW', 'C: 8 % libre', false],
          ['SERVER_ALERT_CLEARED', 11, 'AGENT_SILENT', 'sin datos desde 14:32', false],
        ]);
      });

      it('tras reiniciar, las alertas guardadas siembran la comparación: no se repite el aviso; la que se fue mientras tanto → CLEARED', async () => {
        central.serverAlerts = [];
        const engine = make(fakeCheck(() => true).fn);
        engine.start();
        await clock.advance(1);
        central.serverAlerts = [disk(), disk('D: 5 % libre')];
        await clock.advance(15000);
        expect(alertEvents(engine).map((x) => [x[0], x[4]])).toEqual([['SERVER_ALERT_STARTED', true], ['SERVER_ALERT_STARTED', true]]);
        reopen(engine);
        central.serverAlerts = [disk()];
        const e2 = make(fakeCheck(() => true).fn, outbox);
        e2.start();
        await clock.advance(1);
        expect(alertEvents(e2).slice(2)).toEqual([['SERVER_ALERT_CLEARED', 10, 'DISK_LOW', 'D: 5 % libre', false]]);
      });

      it('una central vieja sin serverAlerts no emite CLEARED: se conserva lo anterior', async () => {
        central.serverAlerts = [];
        const engine = make(fakeCheck(() => true).fn);
        engine.start();
        await clock.advance(1);
        central.serverAlerts = [disk()];
        await clock.advance(15000);
        central.serverAlerts = undefined;
        await clock.advance(30000);
        expect(alertEvents(engine).map((x) => x[0])).toEqual(['SERVER_ALERT_STARTED']);
        expect(engine.status().serverAlerts).toEqual([disk()]);
      });

      it('central vieja desde el principio: sin alertas en status ni eventos', async () => {
        const engine = make(fakeCheck(() => true).fn);
        engine.start();
        await clock.advance(1);
        expect(engine.status().serverAlerts).toEqual([]);
        await clock.advance(15000);
        expect(alertEvents(engine)).toEqual([]);
      });

      it('mantenimiento: un servicio caído que entra en la ventana no da RECOVERED; se guarda el estado enmascarado; al salir caído con otro incidente, OPENED sin repetir el aviso (decisión 19)', async () => {
        central.state = [{ ...row(1), status: 'DOWN', incidentId: 5 }];
        const engine = make(fakeCheck(() => true).fn);
        engine.start();
        await clock.advance(1);
        central.state = [{ ...row(1), maintenance: true }];
        await clock.advance(15000);
        expect(kinds(engine)).toEqual([]);
        const frozen = { ...row(1), status: 'DOWN', incidentId: 5, maintenance: true };
        expect(engine.status().services).toEqual([frozen]);
        expect(JSON.parse(outbox.loadState()!)).toEqual([frozen]);
        central.state = [{ ...row(1), status: 'DOWN', incidentId: 9, maintenance: false }];
        await clock.advance(15000);
        // Para quien mira, el servicio siguió caído: ya se avisó al entrar, no hay RECOVERED intermedio.
        expect(engine.events(0, 500).events.map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_OPENED', 9, false]]);
      });

      it('mantenimiento: un incidente abierto durante la ventana avisa recién al salir de ella', async () => {
        const engine = make(fakeCheck(() => true).fn);
        engine.start();
        await clock.advance(1);
        central.state = [{ ...row(1), status: 'DOWN', incidentId: 7, maintenance: true }];
        await clock.advance(30000);
        expect(kinds(engine)).toEqual([]);
        expect(engine.status().services).toEqual([{ ...row(1), maintenance: true }]);
        central.state = [{ ...row(1), status: 'DOWN', incidentId: 7 }];
        await clock.advance(15000);
        expect(engine.events(0, 500).events.map((e) => [e.kind, e.incidentKey, e.notify])).toEqual([['INCIDENT_OPENED', 7, true]]);
      });
    });

    describe('reinicio del motor (las marcas del diario persisten)', () => {
      const officeCfg = (): ProbeConfig => ({ services: [svc(1), svc(2)], schedule: DEFAULT_SCHEDULE, references: [svc(1001)] });
      const pairs = (e: Engine) => e.events(0, 500).events.map((x) => [x.kind, x.notify]);
      const reopen = (e: Engine) => {
        e.stop();
        outbox.close();
        outbox = new Outbox(join(dir, 'engine.db'));
      };

      it('reinicio durante una caída de oficina: no vuelve a avisar; al terminar, OFFICE_OUTAGE_ENDED sin aviso', async () => {
        let internet = false;
        central.config = officeCfg();
        const e1 = make(fakeCheck(() => internet).fn);
        e1.start();
        await clock.advance(6 * 60_000);
        expect(pairs(e1)).toEqual([['OFFICE_OUTAGE_STARTED', true]]);
        reopen(e1);

        const e2 = make(fakeCheck(() => internet).fn, outbox);
        e2.start();
        expect(e2.status().officeOutage).toBe(true);
        await clock.advance(11 * 60_000);
        expect(pairs(e2)).toEqual([['OFFICE_OUTAGE_STARTED', true]]);
        internet = true;
        await clock.advance(11 * 60_000);
        expect(pairs(e2)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['OFFICE_OUTAGE_ENDED', false],
        ]);
      });

      it('la caída terminó con el motor parado: el primer veredicto anota OFFICE_OUTAGE_ENDED sin aviso', async () => {
        let internet = false;
        central.config = officeCfg();
        const e1 = make(fakeCheck(() => internet).fn);
        e1.start();
        await clock.advance(6 * 60_000);
        reopen(e1);
        internet = true;
        const e2 = make(fakeCheck(() => internet).fn, outbox);
        e2.start();
        await clock.advance(6 * 60_000);
        expect(e2.status().officeOutage).toBe(false);
        expect(pairs(e2)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['OFFICE_OUTAGE_ENDED', false],
        ]);
      });

      it('reinicio con la central sin responder: no se repite CENTRAL_UNREACHABLE; al volver, CENTRAL_BACK', async () => {
        const e1 = make(fakeCheck(() => true).fn);
        e1.start();
        await clock.advance(1);
        central.down = true;
        await clock.advance(45_000);
        expect(pairs(e1)).toEqual([['CENTRAL_UNREACHABLE', true]]);
        reopen(e1);

        const e2 = make(fakeCheck(() => true).fn, outbox);
        e2.start();
        await clock.advance(2 * 60_000);
        expect(pairs(e2)).toEqual([['CENTRAL_UNREACHABLE', true]]);
        central.down = false;
        await clock.advance(15_000);
        expect(pairs(e2)).toEqual([
          ['CENTRAL_UNREACHABLE', true],
          ['CENTRAL_BACK', false],
        ]);
      });

      it('reinicio con el aviso pendiente: se guarda y se decide con el primer veredicto del motor nuevo', async () => {
        central.config = officeCfg();
        const e1 = make(fakeCheck(() => true).fn);
        e1.start();
        await clock.advance(9 * 60_000 + 5_000); // 15:09:05
        central.down = true;
        await clock.advance(56_000); // fallos a las 15:09:15, :30 y :45 → pendiente
        expect(JSON.parse(outbox.loadKv('journal')!)).toMatchObject({
          unreachableJournaled: false,
          pending: { since: Date.parse('2026-11-23T15:09:15.000Z') },
        });
        reopen(e1);

        const e2 = make(fakeCheck(() => true).fn, outbox);
        e2.start(); // 15:10:01: el runner nuevo juzga primero la franja de las 15:15
        await clock.advance(4 * 60_000);
        expect(pairs(e2)).toEqual([]);
        await clock.advance(2 * 60_000); // 15:16:01
        expect(pairs(e2)).toEqual([['CENTRAL_UNREACHABLE', true]]);
        expect(JSON.parse(outbox.loadKv('journal')!)).toMatchObject({ unreachableJournaled: true, pending: null });
      });

      // El plazo guardado (15:17:00) es absoluto: el motor nuevo lo recalcula desde su arranque.
      const restartWithPendingDuringOfficeCut = async (restartAt: string) => {
        let internet = true;
        central.config = officeCfg();
        const e1 = make(fakeCheck(() => internet).fn);
        e1.start();
        await clock.advance(9 * 60_000 + 5_000); // 15:09:05: cae internet de la oficina
        internet = false;
        central.down = true;
        await clock.advance(56_000); // 15:10:01: pendiente desde las 15:09:15, plazo 15:17:00
        expect(JSON.parse(outbox.loadKv('journal')!)).toMatchObject({
          pending: { since: Date.parse('2026-11-23T15:09:15.000Z'), deadline: Date.parse('2026-11-23T15:17:00.000Z') },
        });
        reopen(e1);
        await clock.advance(Date.parse(restartAt) - clock.now().getTime());

        const e2 = make(fakeCheck(() => internet).fn, outbox);
        e2.start();
        await clock.advance(20 * 60_000);
        expect(e2.events(0, 500).events.filter((x) => x.notify).map((x) => x.kind)).toEqual(['OFFICE_OUTAGE_STARTED']);
        expect(pairs(e2)).toEqual([
          ['OFFICE_OUTAGE_STARTED', true],
          ['CENTRAL_UNREACHABLE', false],
        ]);
      };

      it('reinicio con el aviso pendiente pasado el plazo guardado y sin internet: un solo aviso, OFFICE_OUTAGE_STARTED', async () => {
        await restartWithPendingDuringOfficeCut('2026-11-23T15:20:00.000Z');
      });

      it('reinicio con el aviso pendiente a menos de 2 min del plazo guardado y sin internet: un solo aviso, OFFICE_OUTAGE_STARTED', async () => {
        await restartWithPendingDuringOfficeCut('2026-11-23T15:16:00.000Z');
      });
    });
  });
});
