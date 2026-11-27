import { FindOperator } from 'typeorm';
import { AvailabilityRollupService } from './availability-rollup.service';
import { LATENCY_BUCKETS_MS, PERCENT_BUCKETS } from './domain/latency-histogram';
import { MonitorAgentDailyRollup } from './entities/monitor-agent-daily-rollup.entity';
import { MonitorAgentSample } from './entities/monitor-agent-sample.entity';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorDailyRollup } from './entities/monitor-daily-rollup.entity';
import { MonitorIncidentEvent } from './entities/monitor-incident-event.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorOfficeOutage } from './entities/monitor-office-outage.entity';
import { MonitorProbeGap } from './entities/monitor-probe-gap.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorRollupDay } from './entities/monitor-rollup-day.entity';
import { MonitorService } from './entities/monitor-service.entity';

// --- Base en memoria: entiende los operadores de búsqueda que usa el servicio. ---
type Row = Record<string, any>;
const cmp = (a: any, b: any) => (a instanceof Date ? a.getTime() : a) - (b instanceof Date ? b.getTime() : b);
const lt = (a: any, b: any) => (typeof a === 'string' ? a < b : cmp(a, b) < 0);
const gt = (a: any, b: any) => (typeof a === 'string' ? a > b : cmp(a, b) > 0);

function matchValue(v: any, cond: any): boolean {
  if (cond instanceof FindOperator) {
    const op = cond as FindOperator<any>;
    switch (op.type) {
      case 'isNull': return v === null || v === undefined;
      case 'not': return !matchValue(v, op.value);
      case 'in': return (op.value as any[]).includes(v);
      case 'lessThan': return v !== null && lt(v, op.value);
      case 'moreThan': return v !== null && gt(v, op.value);
      case 'moreThanOrEqual': return v !== null && !lt(v, op.value);
      case 'lessThanOrEqual': return v !== null && !gt(v, op.value);
      case 'between': return v !== null && !lt(v, (op.value as any[])[0]) && !gt(v, (op.value as any[])[1]);
      case 'and': return (op.value as any[]).every((c) => matchValue(v, c));
      default: throw new Error(`operador no soportado en el doble: ${op.type}`);
    }
  }
  return v instanceof Date ? cmp(v, cond) === 0 : v === cond;
}
const matches = (row: Row, where: any): boolean =>
  !where ? true : Array.isArray(where) ? where.some((w) => matches(row, w)) : Object.entries(where).every(([k, c]) => matchValue(row[k], c));

class FakeRepo {
  rows: Row[] = [];
  private seq = 1;
  constructor(private readonly pk = 'id') {}
  async find(opts: any = {}) {
    let out = this.rows.filter((r) => matches(r, opts.where));
    const order = opts.order ? Object.entries(opts.order) : [];
    for (const [k, dir] of order.reverse()) out = [...out].sort((a, b) => (dir === 'DESC' ? -1 : 1) * (lt(a[k], b[k]) ? -1 : gt(a[k], b[k]) ? 1 : 0));
    return out.map((r) => ({ ...r }));
  }
  async findOne(opts: any = {}) {
    return (await this.find(opts))[0] ?? null;
  }
  async delete(where: any) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, where));
    return { affected: before - this.rows.length };
  }
  async insert(x: Row | Row[]) {
    for (const r of Array.isArray(x) ? x : [x]) this.rows.push({ ...r, [this.pk]: r[this.pk] ?? this.seq++ });
    return {};
  }
  async save(r: Row) {
    const i = this.rows.findIndex((x) => x[this.pk] === r[this.pk]);
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...r };
    else this.rows.push({ ...r });
    return r;
  }
}

function fakeDs() {
  const repos = new Map<any, FakeRepo>([
    [MonitorService, new FakeRepo()],
    [MonitorProbe, new FakeRepo()],
    [MonitorCheck, new FakeRepo()],
    [MonitorIncident, new FakeRepo()],
    [MonitorIncidentEvent, new FakeRepo()],
    [MonitorOfficeOutage, new FakeRepo()],
    [MonitorDailyRollup, new FakeRepo()],
    [MonitorProbeGap, new FakeRepo()],
    [MonitorRollupDay, new FakeRepo('date')],
    [MonitorAgentSample, new FakeRepo()],
    [MonitorAgentDailyRollup, new FakeRepo()],
  ]);
  const manager = { getRepository: (e: any) => repos.get(e)! };
  const ds = { getRepository: manager.getRepository, transaction: jest.fn(async (fn: any) => fn(manager)) };
  return { ds: ds as any, repo: (e: any) => repos.get(e)! };
}

// Día 2026-11-20 de Lima = [2026-11-20T05:00Z, 2026-11-21T05:00Z).
const z = (s: string) => new Date(`2026-11-20T${s}:00.000Z`);
const DAY = '2026-11-20';
const NOW = new Date('2026-11-23T12:00:00.000Z');

function seed() {
  const { ds, repo } = fakeDs();
  const created = new Date('2026-01-01T00:00:00Z');
  repo(MonitorService).rows.push(
    { id: 1, status: 'ACTIVE', createdAt: created },
    { id: 2, status: 'PAUSED', createdAt: created },
    { id: 3, status: 'ARCHIVED', createdAt: created },
    { id: 4, status: 'ACTIVE', createdAt: new Date('2026-11-22T00:00:00Z') }, // aún no existía
  );
  repo(MonitorProbe).rows.push({ id: 10, code: 'kubo-01' }, { id: 11, code: 'oficina-01' }); // 11 nunca reportó
  let n = 0;
  const check = (serviceId: number, kind: string, startedAt: Date, ok: boolean, durationMs: number) =>
    repo(MonitorCheck).rows.push({ probeId: 10, id: `c${n++}`, serviceId, kind, startedAt, ok, durationMs });
  check(1, 'REGULAR', z('06:00'), true, 10);
  check(1, 'REGULAR', z('06:01'), true, 30);
  check(1, 'REGULAR', z('06:02'), true, 30);
  check(1, 'REGULAR', z('06:03'), false, 5000);
  check(1, 'RETRY', z('06:04'), true, 20);
  check(2, 'REGULAR', z('06:05'), true, 1200);
  check(1, 'REGULAR', new Date('2026-11-19T12:00:00Z'), true, 10); // otro día
  // Servicio 1: ROUTE subido a DOWN (30 + 30 min); el padre de servidor y el DEGRADED no cuentan.
  repo(MonitorIncident).rows.push(
    { id: 100, serviceId: 1, kind: 'DOWN', firstFailureAt: z('10:00'), recoveredAt: z('11:00') },
    { id: 101, serviceId: null, kind: 'DOWN', firstFailureAt: z('10:00'), recoveredAt: z('11:00') },
    { id: 102, serviceId: 2, kind: 'DEGRADED', firstFailureAt: z('10:00'), recoveredAt: null },
    { id: 103, serviceId: 2, kind: 'DOWN', firstFailureAt: new Date('2026-11-21T04:00:00Z'), recoveredAt: null },
  );
  repo(MonitorIncidentEvent).rows.push({ id: 1, incidentId: 100, type: 'UPGRADED_TO_DOWN', at: z('10:30') });
  repo(MonitorOfficeOutage).rows.push({ id: 1, probeId: 10, startedAt: z('08:00'), endedAt: z('09:00') });
  const svc = new AvailabilityRollupService(ds);
  return { svc, repo, ds };
}

const strip = (rows: Row[]) =>
  rows
    .map(({ id, ...r }) => ({ ...r, startedAt: r.startedAt?.toISOString(), endedAt: r.endedAt?.toISOString() }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('AvailabilityRollupService.rollupDay', () => {
  it('resume por servicio activo/pausado y sonda que ya reportaba', async () => {
    const { svc, repo } = seed();
    await svc.rollupDay(DAY, NOW);
    const rows = repo(MonitorDailyRollup).rows;
    expect(rows.map((r) => [r.serviceId, r.probeId]).sort()).toEqual([[1, 10], [2, 10]]);

    const r1 = rows.find((r) => r.serviceId === 1)!;
    expect(r1).toMatchObject({ date: DAY, expected: 720, executed: 4, succeeded: 3, p50Ms: 50, p95Ms: 50 });
    expect(r1.latencyHist).toHaveLength(LATENCY_BUCKETS_MS.length);
    expect(r1.latencyHist[0]).toBe(1);
    expect(r1.latencyHist[1]).toBe(2);
    expect(r1.routeMinutes).toBe(30);
    expect(r1.downMinutes).toBe(30);
    expect(r1.noDataMinutes).toBe(1432); // (720 − 4) × 2 min

    const r2 = rows.find((r) => r.serviceId === 2)!;
    expect(r2).toMatchObject({ executed: 1, succeeded: 1, p50Ms: 1500, p95Ms: 1500, routeMinutes: 0 });
    expect(r2.downMinutes).toBe(60); // DOWN abierto desde 04:00Z hasta el fin del día (05:00Z)
  });

  it('huecos: silencios de la sonda y la caída de oficina, sin contar dos veces', async () => {
    const { svc, repo } = seed();
    await svc.rollupDay(DAY, NOW);
    const gaps = repo(MonitorProbeGap).rows.map((g) => [g.probeId, g.cause, g.startedAt.toISOString(), g.endedAt.toISOString(), g.date]);
    expect(gaps).toEqual(
      expect.arrayContaining([
        [10, 'PROBE_SILENT', '2026-11-20T05:00:00.000Z', '2026-11-20T06:00:00.000Z', DAY],
        [10, 'PROBE_SILENT', '2026-11-20T06:05:00.000Z', '2026-11-20T08:00:00.000Z', DAY],
        [10, 'OFFICE_OUTAGE', '2026-11-20T08:00:00.000Z', '2026-11-20T09:00:00.000Z', DAY],
        [10, 'PROBE_SILENT', '2026-11-20T09:00:00.000Z', '2026-11-21T05:00:00.000Z', DAY],
      ]),
    );
    expect(gaps).toHaveLength(4); // la sonda 11 nunca reportó: sin huecos
  });

  it('es idempotente: dos pasadas dejan las mismas filas, sin duplicados, en una transacción cada una', async () => {
    const { svc, repo, ds } = seed();
    await svc.rollupDay(DAY, NOW);
    const first = { r: strip(repo(MonitorDailyRollup).rows), g: strip(repo(MonitorProbeGap).rows) };
    await svc.rollupDay(DAY, NOW);
    expect(strip(repo(MonitorDailyRollup).rows)).toEqual(first.r);
    expect(strip(repo(MonitorProbeGap).rows)).toEqual(first.g);
    expect(repo(MonitorRollupDay).rows).toEqual([{ date: DAY, computedAt: NOW }]);
    expect(ds.transaction).toHaveBeenCalledTimes(2);
  });

  it('no toca otras fechas', async () => {
    const { svc, repo } = seed();
    repo(MonitorDailyRollup).rows.push({ id: 999, serviceId: 1, probeId: 10, date: '2026-11-19' });
    repo(MonitorProbeGap).rows.push({ id: 999, probeId: 10, date: '2026-11-19' });
    await svc.rollupDay(DAY, NOW);
    expect(repo(MonitorDailyRollup).rows.some((r) => r.id === 999)).toBe(true);
    expect(repo(MonitorProbeGap).rows.some((r) => r.id === 999)).toBe(true);
  });

  it('un servicio archivado después del día conserva su resumen si tuvo checks ese día', async () => {
    const { svc, repo } = seed();
    // Servicio 3 (ARCHIVED) midió el día 20; el 5 (ARCHIVED) solo midió el 19.
    repo(MonitorService).rows.push({ id: 5, status: 'ARCHIVED', createdAt: new Date('2026-01-01T00:00:00Z') });
    repo(MonitorCheck).rows.push(
      { probeId: 10, id: 'a3', serviceId: 3, kind: 'REGULAR', startedAt: z('07:00'), ok: true, durationMs: 10 },
      { probeId: 10, id: 'a5', serviceId: 5, kind: 'REGULAR', startedAt: new Date('2026-11-19T12:00:00Z'), ok: true, durationMs: 10 },
    );
    await svc.rollupDay(DAY, NOW);
    const rows = repo(MonitorDailyRollup).rows;
    expect(rows.map((r) => [r.serviceId, r.probeId]).sort()).toEqual([[1, 10], [2, 10], [3, 10]]);
    expect(rows.find((r) => r.serviceId === 3)).toMatchObject({ executed: 1, succeeded: 1, expected: 720 });
  });
});

describe('AvailabilityRollupService.rollupDay (agente)', () => {
  const disks = (free: number) => [{ name: 'C:', totalBytes: 100, freeBytes: free }];

  it('por servidor con muestras: cantidad, histogramas de CPU y RAM y discos de la última muestra del día', async () => {
    const { svc, repo } = seed();
    repo(MonitorAgentSample).rows.push(
      { id: 1, serverId: 5, at: z('06:00'), cpuPct: 3, ramPct: 50, disks: disks(40) },
      { id: 2, serverId: 5, at: z('23:59'), cpuPct: 97.5, ramPct: 100, disks: disks(30) },
      { id: 3, serverId: 5, at: z('12:00'), cpuPct: 10, ramPct: 52, disks: disks(35) },
      { id: 4, serverId: 6, at: new Date('2026-11-21T05:00:00.000Z'), cpuPct: 1, ramPct: 1, disks: disks(1) }, // día siguiente
      { id: 5, serverId: 5, at: new Date('2026-11-20T04:59:59.000Z'), cpuPct: 1, ramPct: 1, disks: disks(1) }, // día anterior
    );
    await svc.rollupDay(DAY, NOW);
    const rows = repo(MonitorAgentDailyRollup).rows;
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({ serverId: 5, date: DAY, samples: 3, disksClose: disks(30) });
    expect(r.cpuHist).toHaveLength(PERCENT_BUCKETS.length);
    expect(r.cpuHist[0]).toBe(1); // 3 %
    expect(r.cpuHist[2]).toBe(1); // 10 %
    expect(r.cpuHist[19]).toBe(1); // 97,5 %
    expect(r.ramHist[10]).toBe(2); // 50 y 52 %
    expect(r.ramHist[20]).toBe(1); // 100 %
  });

  it('es idempotente y no toca otras fechas', async () => {
    const { svc, repo } = seed();
    repo(MonitorAgentSample).rows.push({ id: 1, serverId: 5, at: z('06:00'), cpuPct: 3, ramPct: 50, disks: disks(40) });
    repo(MonitorAgentDailyRollup).rows.push({ id: 999, serverId: 5, date: '2026-11-19' });
    await svc.rollupDay(DAY, NOW);
    await svc.rollupDay(DAY, NOW);
    expect(repo(MonitorAgentDailyRollup).rows.filter((r) => r.date === DAY)).toHaveLength(1);
    expect(repo(MonitorAgentDailyRollup).rows.some((r) => r.id === 999)).toBe(true);
  });
});

describe('AvailabilityRollupService.ensureRange', () => {
  it('salta los días ya marcados, el día en curso y los de hace más de 89 días', async () => {
    const { svc, repo } = seed();
    repo(MonitorRollupDay).rows.push({ date: '2026-11-21', computedAt: NOW });
    const spy = jest.spyOn(svc, 'rollupDay').mockResolvedValue();
    // NOW = 2026-11-23 07:00 Lima → hoy 2026-11-23; mínimo 2026-08-26.
    await svc.ensureRange('2026-08-20', '2026-11-23', NOW);
    const days = spy.mock.calls.map((c) => c[0]);
    expect(days[0]).toBe('2026-08-26');
    expect(days[days.length - 1]).toBe('2026-11-22');
    expect(days).not.toContain('2026-11-21');
    expect(days).not.toContain('2026-11-23');
    expect(days).toHaveLength(88);
  });

  it('un día que falla se registra y no detiene los demás', async () => {
    const { svc } = seed();
    const spy = jest.spyOn(svc, 'rollupDay').mockRejectedValueOnce(new Error('db')).mockResolvedValue();
    await expect(svc.ensureRange('2026-11-20', '2026-11-22', NOW)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('dos ensureRange simultáneos (informe y resumen al arrancar) nunca calculan la misma fecha en paralelo', async () => {
    const { svc } = seed();
    const active = new Map<string, number>();
    let maxSameDate = 0;
    let maxOverall = 0;
    const calls: string[] = [];
    const tick = () => new Promise<void>((r) => setImmediate(r));
    jest.spyOn(svc as any, 'computeDay').mockImplementation(async (...args: unknown[]) => {
      const d = args[0] as string;
      calls.push(d);
      active.set(d, (active.get(d) ?? 0) + 1);
      maxSameDate = Math.max(maxSameDate, active.get(d)!);
      maxOverall = Math.max(maxOverall, [...active.values()].reduce((a, b) => a + b, 0));
      await tick();
      await tick();
      active.set(d, active.get(d)! - 1);
    });
    await Promise.all([svc.ensureRange('2026-11-20', '2026-11-22', NOW), svc.ensureRange('2026-11-20', '2026-11-22', NOW)]);
    expect(calls).toHaveLength(6);
    expect(maxSameDate).toBe(1);
    expect(maxOverall).toBe(1);
  });

  it('un cálculo que falla no bloquea el cerrojo para los siguientes', async () => {
    const { svc } = seed();
    const spy = jest.spyOn(svc as any, 'computeDay').mockRejectedValueOnce(new Error('db')).mockResolvedValue(undefined);
    await expect(svc.rollupDay('2026-11-20', NOW)).rejects.toThrow('db');
    await expect(svc.rollupDay('2026-11-21', NOW)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('AvailabilityRollupService.run', () => {
  it('completa los días viejos que falten y recalcula siempre ayer y anteayer (datos tardíos)', async () => {
    const { svc } = seed();
    const order: string[] = [];
    const ensure = jest.spyOn(svc, 'ensureRange').mockImplementation(async (a, b) => void order.push(`range ${a}..${b}`));
    const day = jest.spyOn(svc, 'rollupDay').mockImplementation(async (d) => void order.push(d));
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      await svc.run();
    } finally {
      jest.useRealTimers();
    }
    expect(ensure).toHaveBeenCalledWith('2026-08-26', '2026-11-20', NOW);
    expect(day.mock.calls).toEqual([['2026-11-21', NOW], ['2026-11-22', NOW]]);
    expect(order).toEqual(['range 2026-08-26..2026-11-20', '2026-11-21', '2026-11-22']);
  });

  it('recalcula ayer y anteayer aunque ya estén en monitor_rollup_days, e incluye checks subidos tarde', async () => {
    const { svc, repo } = seed();
    repo(MonitorProbe).rows = [{ id: 10, code: 'oficina-01' }];
    repo(MonitorService).rows = [{ id: 1, status: 'ACTIVE', createdAt: new Date('2026-01-01T00:00:00Z') }];
    repo(MonitorCheck).rows = [];
    const y = '2026-11-22';
    const at = new Date('2026-11-22T12:00:00.000Z');
    repo(MonitorCheck).rows.push({ probeId: 10, id: 'a', serviceId: 1, kind: 'REGULAR', startedAt: at, ok: true, durationMs: 10 });
    const ensure = jest.spyOn(svc, 'ensureRange').mockResolvedValue();
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      await svc.run();
      const first = repo(MonitorDailyRollup).rows.find((r) => r.date === y)!;
      expect(first.executed).toBe(1);
      // La sonda de la oficina sube tarde lo que guardó durante un corte.
      repo(MonitorCheck).rows.push({ probeId: 10, id: 'b', serviceId: 1, kind: 'REGULAR', startedAt: new Date(at.getTime() + 120_000), ok: true, durationMs: 10 });
      await svc.run();
    } finally {
      jest.useRealTimers();
    }
    expect(ensure).toHaveBeenCalledTimes(2);
    const rows = repo(MonitorDailyRollup).rows.filter((r) => r.date === y);
    expect(rows).toHaveLength(1);
    expect(rows[0].executed).toBe(2);
  });

  it('un día reciente que falla se registra y no detiene el otro', async () => {
    const { svc } = seed();
    jest.spyOn(svc, 'ensureRange').mockResolvedValue();
    const day = jest.spyOn(svc, 'rollupDay').mockRejectedValueOnce(new Error('db')).mockResolvedValue();
    await expect(svc.run()).resolves.toBeUndefined();
    expect(day).toHaveBeenCalledTimes(2);
  });

  it('no corre dos pasadas a la vez y no lanza si falla', async () => {
    const { svc } = seed();
    let release!: () => void;
    const spy = jest.spyOn(svc, 'ensureRange').mockImplementation(() => new Promise<void>((r) => (release = r)));
    const a = svc.run();
    await svc.run(); // se salta: la primera sigue en curso
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    await a;
    spy.mockRejectedValueOnce(new Error('db'));
    await expect(svc.run()).resolves.toBeUndefined();
  });

  it('onApplicationBootstrap lanza la pasada sin esperarla', async () => {
    const { svc } = seed();
    const spy = jest.spyOn(svc, 'ensureRange').mockImplementation(() => new Promise<void>(() => undefined));
    expect(svc.onApplicationBootstrap()).toBeUndefined();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
