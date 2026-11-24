import { FindOperator } from 'typeorm';
import { AvailabilityIngestService } from './availability-ingest.service';
import { CheckResult, DEFAULT_SCHEDULE, ProbeSignal } from './core';

/** Filtro de `where` mínimo: igualdad, IsNull() e In(). */
const matches = (row: any, where: Record<string, any> = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (v instanceof FindOperator) {
      if (v.type === 'isNull') return row[k] === null || row[k] === undefined;
      if (v.type === 'in') return (v.value as any[]).includes(row[k]);
      throw new Error(`operador no soportado: ${v.type}`);
    }
    return row[k] === v;
  });

const repoOf = (rows: any[], keyOf?: (r: any) => string) => {
  const qb: any = {};
  qb.insert = () => qb;
  qb.into = () => qb;
  qb.values = (v: any[]) => {
    qb._v = v;
    return qb;
  };
  qb.orIgnore = () => qb;
  qb.execute = async () => {
    let affectedRows = 0;
    for (const v of qb._v as any[]) {
      if (keyOf && rows.some((r) => keyOf(r) === keyOf(v))) continue;
      rows.push({ ...v });
      affectedRows++;
    }
    return { raw: { affectedRows } };
  };
  return {
    rows,
    find: jest.fn(async (opts?: any) => rows.filter((r) => matches(r, opts?.where))),
    findOne: jest.fn(async (opts: any) => rows.find((r) => matches(r, opts.where)) ?? null),
    update: jest.fn(async (where: any, patch: any) => {
      const w = typeof where === 'object' ? where : { id: where };
      const hit = rows.filter((r) => matches(r, w));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    }),
    createQueryBuilder: () => qb,
  };
};

const T0 = new Date('2026-11-23T15:00:00.000Z');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mkCheck = (n: number, over: Partial<CheckResult> = {}): CheckResult => ({
  id: uuid(n),
  serviceId: 100,
  kind: 'REGULAR',
  cycleAt: T0.toISOString(),
  startedAt: T0.toISOString(),
  durationMs: 50,
  ok: true,
  errorCode: null,
  httpStatus: null,
  orderId: null,
  ...over,
});
const mkSignal = (n: number): ProbeSignal => ({
  id: uuid(1000 + n),
  type: 'VERIFYING',
  serviceId: 100,
  at: T0.toISOString(),
  firstFailureAt: T0.toISOString(),
});

const SERVICE = {
  id: 100, serverId: 10, name: 'web', protocol: 'HTTPS', target: 'https://x.test', port: null,
  latencyThresholdMs: 1500, criticality: 'HIGH', status: 'ACTIVE',
};

const makeSvc = (seed: { services?: any[]; orders?: any[]; incidents?: any[]; states?: any[] } = {}) => {
  const probe: any = { id: 1, code: 'oficina-01', kind: 'OFFICE', tokenHash: 'x', lastSeenAt: null, version: null, clockSkewMs: null };
  const probes = repoOf([probe, { id: 2, code: 'kubo-01', kind: 'DATACENTER' }]);
  const checks = repoOf([], (r) => `${r.probeId}|${r.id}`);
  const signals = repoOf([], (r) => `${r.probeId}|${r.uuid}`);
  const orders = repoOf(seed.orders ?? []);
  const states = repoOf(seed.states ?? [], (r) => `${r.probeId}|${r.serviceId}`);
  const services = repoOf(seed.services ?? [{ ...SERVICE }]);
  const servers = repoOf([{ id: 10, clientId: 7, name: 'srv-1', host: 'h', status: 'ACTIVE' }]);
  const incidents = repoOf(seed.incidents ?? []);
  const svc = new AvailabilityIngestService(
    probes as any, checks as any, signals as any, orders as any, states as any, services as any, servers as any, incidents as any,
  );
  return { svc, probe, probes, checks, signals, orders, states, services };
};

describe('AvailabilityIngestService.acceptBatch', () => {
  it('dos veces el mismo lote -> la segunda devuelve 0 aceptados y N duplicados', async () => {
    const { svc, probe, checks, signals } = makeSvc();
    const batch = { checks: [mkCheck(1), mkCheck(2), mkCheck(3)], signals: [mkSignal(1), mkSignal(2)], version: '1.0.0' };
    const first = await svc.acceptBatch(probe, batch, T0);
    expect(first).toEqual({ acceptedChecks: 3, duplicateChecks: 0, acceptedSignals: 2, duplicateSignals: 0 });
    const second = await svc.acceptBatch(probe, batch, T0);
    expect(second).toEqual({ acceptedChecks: 0, duplicateChecks: 3, acceptedSignals: 0, duplicateSignals: 2 });
    expect(checks.rows).toHaveLength(3);
    expect(signals.rows).toHaveLength(2);
  });

  it('startedAt 10 min en el futuro: se acepta, received_at es de la central y clock_skew_ms ~ -600000', async () => {
    const { svc, checks, probe, probes } = makeSvc();
    const future = new Date(T0.getTime() + 600_000 + 50).toISOString();
    await svc.acceptBatch(probe, { checks: [mkCheck(1, { startedAt: future, durationMs: 50 })], signals: [], version: '1.2.3' }, T0);
    expect(checks.rows).toHaveLength(1);
    expect(checks.rows[0].receivedAt).toEqual(T0);
    const patch = probes.update.mock.calls[0][1];
    expect(patch.clockSkewMs).toBe(-600_100);
    expect(Math.abs(patch.clockSkewMs + 600_000)).toBeLessThan(1000);
    expect(patch.version).toBe('1.2.3');
    expect(patch.lastSeenAt).toEqual(T0);
  });

  it('clock_skew_ms es el mínimo de los checks nuevos', async () => {
    const { svc, probe, probes } = makeSvc();
    const at = (ms: number) => new Date(T0.getTime() - ms).toISOString();
    await svc.acceptBatch(
      probe,
      { checks: [mkCheck(1, { startedAt: at(100), durationMs: 0 }), mkCheck(2, { startedAt: at(201), durationMs: 0 })], signals: [], version: 'v' },
      T0,
    );
    expect(probes.update.mock.calls[0][1].clockSkewMs).toBe(100);
  });

  it('lote sin checks no toca clock_skew_ms', async () => {
    const { svc, probe, probes } = makeSvc();
    await svc.acceptBatch(probe, { checks: [], signals: [], version: 'v' }, T0);
    expect(probes.update.mock.calls[0][1]).not.toHaveProperty('clockSkewMs');
  });

  it('actualiza monitor_probe_states con la última comprobación y marca done_at de las órdenes', async () => {
    const { svc, probe, states, orders } = makeSvc({
      orders: [{ id: 9, probeId: 1, serviceId: 100, kind: 'MANUAL', takenAt: T0, doneAt: null }],
    });
    const later = new Date(T0.getTime() + 1000).toISOString();
    await svc.acceptBatch(
      probe,
      { checks: [mkCheck(1), mkCheck(2, { startedAt: later, ok: false, durationMs: 77, orderId: 9, kind: 'MANUAL' })], signals: [], version: 'v' },
      T0,
    );
    expect(states.rows).toHaveLength(1);
    expect(states.rows[0]).toMatchObject({ serviceId: 100, probeId: 1, lastOk: false, lastLatencyMs: 50 });
    expect(states.rows[0].lastCheckAt.getTime()).toBeLessThanOrEqual(T0.getTime());
    expect(states.rows[0].lastCheckAt.getTime()).toBeGreaterThan(T0.getTime() - 1000);
    expect(orders.rows[0].doneAt).toEqual(T0);
  });

  it('un lote viejo reenviado no retrocede last_check_at', async () => {
    const newer = new Date(T0.getTime() + 60_000);
    const { svc, probe, states } = makeSvc({
      states: [{ serviceId: 100, probeId: 1, state: 'OK', lastCheckAt: newer, lastOk: true, lastLatencyMs: 5 }],
    });
    await svc.acceptBatch(probe, { checks: [mkCheck(1, { ok: false })], signals: [], version: 'v' }, T0);
    expect(states.rows[0].lastCheckAt).toEqual(newer);
    expect(states.rows[0].lastOk).toBe(true);
  });
});

describe('hora de la central en monitor_probe_states', () => {
  const at = (ms: number) => new Date(T0.getTime() + ms).toISOString();
  const T1 = new Date(T0.getTime() + 60_000);

  it('startedAt 10 min en el futuro y 20 min en el pasado: last_check_at ~ received_at', async () => {
    const fut = makeSvc();
    await fut.svc.acceptBatch(fut.probe, { checks: [mkCheck(1, { startedAt: at(600_000), durationMs: 0 })], signals: [], version: 'v' }, T0);
    expect(Math.abs(fut.states.rows[0].lastCheckAt.getTime() - T0.getTime())).toBeLessThan(1000);

    const slow = makeSvc();
    expect(slow.probe.clockSkewMs).toBeNull();
    await slow.svc.acceptBatch(slow.probe, { checks: [mkCheck(2, { startedAt: at(-1_200_000), durationMs: 0 })], signals: [], version: 'v' }, T0);
    expect(Math.abs(slow.probes.update.mock.calls[0][1].clockSkewMs - 1_200_000)).toBeLessThan(1000);
    expect(Math.abs(slow.states.rows[0].lastCheckAt.getTime() - T0.getTime())).toBeLessThan(1000);
  });

  it('salto de NTP de -50 min (más de 2 intervalos, T0 fijo a las 10:00 de Lima, franja de día) sigue actualizando el estado', async () => {
    const { svc, probe, states } = makeSvc();
    await svc.acceptBatch(probe, { checks: [mkCheck(1, { startedAt: at(0), durationMs: 0, ok: true })], signals: [], version: 'v' }, T0);
    await svc.acceptBatch(probe, { checks: [mkCheck(2, { startedAt: at(-3_000_000), durationMs: 0, ok: false })], signals: [], version: 'v' }, T1);
    expect(states.rows[0].lastOk).toBe(false);
    expect(states.rows[0].lastCheckAt.getTime()).toBeGreaterThan(T0.getTime());
    expect(states.rows[0].lastCheckAt.getTime()).toBeLessThanOrEqual(T1.getTime());
  });

  it('cola vieja: un check fresco y varios 30 min más viejos (hora de sonda) -> el desfase sale del fresco', async () => {
    const { svc, probe, probes } = makeSvc();
    const checks = [
      mkCheck(1, { startedAt: at(-30_000), durationMs: 0 }),
      mkCheck(2, { startedAt: at(-1_800_000), durationMs: 0 }),
      mkCheck(3, { startedAt: at(-1_790_000), durationMs: 0 }),
    ];
    await svc.acceptBatch(probe, { checks, signals: [], version: 'v' }, T0);
    expect(probes.update.mock.calls[0][1].clockSkewMs).toBe(30_000);
  });

  it('los duplicados no cuentan para el desfase', async () => {
    const { svc, probe, probes } = makeSvc();
    const batch = { checks: [mkCheck(1, { startedAt: at(0), durationMs: 0 })], signals: [], version: 'v' };
    await svc.acceptBatch(probe, batch, T0);
    await svc.acceptBatch(probe, batch, T1);
    expect(probes.update.mock.calls[1][1]).not.toHaveProperty('clockSkewMs');
  });

  it('last_latency_ms solo sale de checks OK', async () => {
    const { svc, probe, states } = makeSvc();
    await svc.acceptBatch(probe, { checks: [mkCheck(1, { durationMs: 40, ok: true })], signals: [], version: 'v' }, T0);
    await svc.acceptBatch(probe, { checks: [mkCheck(2, { startedAt: at(30_000), durationMs: 9000, ok: false })], signals: [], version: 'v' }, T1);
    expect(states.rows[0]).toMatchObject({ lastOk: false, lastLatencyMs: 40 });
  });
});

describe('AvailabilityIngestService.sync', () => {
  it('con la configVersion vigente -> config null; tras editar un servicio -> config nueva', async () => {
    const { svc, services, probe } = makeSvc();
    const first = await svc.sync(probe, null);
    expect(first.config).not.toBeNull();
    expect(first.config!.services).toEqual([{ id: 100, protocol: 'HTTPS', target: 'https://x.test', port: null, latencyThresholdMs: 1500 }]);
    expect(first.config!.schedule).toEqual(DEFAULT_SCHEDULE);
    expect(first.config!.references.map((r) => r.id)).toEqual([-1, -2]);
    expect(first.configVersion).toMatch(/^[0-9a-f]{64}$/);

    const same = await svc.sync(probe, first.configVersion);
    expect(same.config).toBeNull();
    expect(same.configVersion).toBe(first.configVersion);

    services.rows[0].target = 'https://y.test';
    const edited = await svc.sync(probe, first.configVersion);
    expect(edited.config!.services[0].target).toBe('https://y.test');
    expect(edited.configVersion).not.toBe(first.configVersion);
  });

  it('servicios pausados no entran en la config ni en la versión', async () => {
    const base = { serverId: 10, name: 'a', protocol: 'TCP', target: 'h', port: 1, latencyThresholdMs: 1, criticality: 'LOW' };
    const a = makeSvc({ services: [{ ...base, id: 1, status: 'ACTIVE' }] });
    const b = makeSvc({ services: [{ ...base, id: 1, status: 'ACTIVE' }, { ...base, id: 2, status: 'PAUSED' }] });
    expect((await a.svc.sync(a.probe, null)).configVersion).toBe((await b.svc.sync(b.probe, null)).configVersion);
  });

  it('entrega cada orden una sola vez', async () => {
    const { svc, orders, probe } = makeSvc({
      orders: [
        { id: 5, probeId: 1, serviceId: 100, kind: 'CROSS', takenAt: null, doneAt: null },
        { id: 6, probeId: 2, serviceId: 100, kind: 'MANUAL', takenAt: null, doneAt: null },
      ],
    });
    const first = await svc.sync(probe, null);
    expect(first.orders).toEqual([{ id: 5, serviceId: 100, kind: 'CROSS' }]);
    expect(orders.rows[0].takenAt).toBeInstanceOf(Date);
    expect(orders.rows[1].takenAt).toBeNull();
    const second = await svc.sync(probe, null);
    expect(second.orders).toEqual([]);
  });

  it('state combina sondas e incidente abierto', async () => {
    const { svc, probe } = makeSvc({
      states: [{ serviceId: 100, probeId: 1, state: 'OK', lastCheckAt: new Date(), lastOk: true, lastLatencyMs: 10 }],
      incidents: [{ id: 50, serviceId: 100, serverId: 10, parentId: 40, kind: 'DOWN', recoveredAt: null }],
    });
    const res = await svc.sync(probe, null);
    expect(res.state).toHaveLength(1);
    expect(res.state[0]).toMatchObject({
      serviceId: 100, serverId: 10, clientId: 7, serviceName: 'web', serverName: 'srv-1', criticality: 'HIGH',
      status: 'DOWN', incidentId: 50, parentIncidentId: 40, ticketCode: null, datacenter: null,
    });
    expect(res.state[0].office).toMatchObject({ state: 'OK', lastLatencyMs: 10 });
  });
});
