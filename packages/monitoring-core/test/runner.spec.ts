import { randomUUID } from 'node:crypto';
import { ProbeRunner } from '../src/runner';
import { DEFAULT_SCHEDULE, nextCycleAt } from '../src/schedule';
import type { CheckFn } from '../src/checks';
import type { ProbeSignal } from '../src/tracker';
import type { CheckKind, CheckResult, ServiceTarget } from '../src/types';
import { FakeClock } from './fake-clock';

const MIN = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 21:00 de Lima (franja de día, 5 min); 22:00 Lima = 03:00Z. */
const LIMA_21H = '2026-11-24T02:00:00.000Z';
/** 23:00 de Lima (franja de noche, 1 min). */
const LIMA_23H = '2026-11-24T04:00:00.000Z';

const svc = (id: number): ServiceTarget => ({ id, protocol: 'TCP', target: `h${id}`, port: 443, latencyThresholdMs: 30_000 });

interface Behavior { ms: number; ok: boolean }
interface Start { id: number; kind: CheckKind; cycleAt: number; at: number; orderId: number | null }

interface SetupOpts {
  start: string;
  services: ServiceTarget[];
  behavior?: (target: ServiceTarget, kind: CheckKind) => Behavior;
  concurrency?: number;
  references?: ServiceTarget[];
}

function setup(o: SetupOpts) {
  const clock = new FakeClock(o.start);
  const behavior = o.behavior ?? (() => ({ ms: 100, ok: true }));
  const delivered: { result: CheckResult; signals: ProbeSignal[] }[] = [];
  const starts: Start[] = [];
  const exits: { id: number; at: number }[] = [];
  const perService = new Map<number, number>();
  const stats = { inFlight: 0, maxInFlight: 0, maxPerService: 0 };

  const check: CheckFn = async (target, kind, cycleAt, opts = {}) => {
    const startedAt = clock.now();
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    const cur = (perService.get(target.id) ?? 0) + 1;
    perService.set(target.id, cur);
    stats.maxPerService = Math.max(stats.maxPerService, cur);
    starts.push({ id: target.id, kind, cycleAt: cycleAt.getTime(), at: startedAt.getTime(), orderId: opts.orderId ?? null });
    const b = behavior(target, kind);
    await clock.sleep(b.ms);
    stats.inFlight--;
    perService.set(target.id, cur - 1);
    exits.push({ id: target.id, at: clock.now().getTime() });
    return {
      id: randomUUID(), serviceId: target.id, kind, cycleAt: cycleAt.toISOString(),
      startedAt: startedAt.toISOString(), durationMs: b.ms, ok: b.ok,
      errorCode: b.ok ? null : 'TIMEOUT', httpStatus: null, orderId: opts.orderId ?? null,
    };
  };

  const runner = new ProbeRunner({
    services: o.services,
    schedule: DEFAULT_SCHEDULE,
    concurrency: o.concurrency ?? 16,
    clock,
    check,
    references: o.references,
    onResult: (result, signals) => delivered.push({ result, signals }),
  });
  const signals = () => delivered.flatMap((d) => d.signals);
  return { clock, runner, delivered, starts, exits, stats, signals };
}

/** Franjas (cycleAt) de un servicio con cycleAt en [from, to). */
function expectedCycles(id: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let c = nextCycleAt(id, new Date(from), DEFAULT_SCHEDULE).getTime(); c < to; c = nextCycleAt(id, new Date(c), DEFAULT_SCHEDULE).getTime()) {
    out.push(c);
  }
  return out;
}

describe('ProbeRunner', () => {
  it('cada servicio recibe exactamente una prueba REGULAR por franja durante 2 h simuladas cruzando las 22:00', async () => {
    const services = [svc(1), svc(2), svc(3)];
    const h = setup({ start: LIMA_21H, services });
    const t0 = h.clock.now().getTime();
    h.runner.start();
    await h.clock.advance(2 * 60 * MIN);
    h.runner.stop();
    const end = t0 + 2 * 60 * MIN;
    for (const s of services) {
      const exp = expectedCycles(s.id, t0, end - 1000); // las de los últimos segundos pueden no haber terminado
      // 12 franjas de día (21:00-22:00) + 60 de noche (22:00-23:00), salvo la última si cae en el borde
      expect(exp.length).toBeGreaterThanOrEqual(71);
      const got = h.delivered
        .filter((d) => d.result.serviceId === s.id && d.result.kind === 'REGULAR')
        .map((d) => Date.parse(d.result.cycleAt))
        .filter((c) => c < end - 1000);
      expect(got).toEqual(exp);
      // empieza en su cycleAt
      for (const st of h.starts.filter((x) => x.id === s.id)) expect(st.at).toBe(st.cycleAt);
    }
    expect(h.signals()).toEqual([]);
  });

  it('un reintento que cae en la franja siguiente sustituye a la regular: en ningún instante hay dos pruebas del mismo servicio en vuelo', async () => {
    // servicio 1 cae durante un rato y vuelve; las pruebas tardan 2 s
    let down = false;
    const h = setup({ start: LIMA_23H, services: [svc(1), svc(2)], behavior: (t) => ({ ms: 2000, ok: !(down && t.id === 1) }) });
    const t0 = h.clock.now().getTime();
    h.runner.start();
    await h.clock.advance(3 * MIN);
    down = true;
    await h.clock.advance(5 * MIN);
    down = false;
    await h.clock.advance(5 * MIN);
    h.runner.stop();

    expect(h.stats.maxPerService).toBe(1);

    const r1 = h.delivered.filter((d) => d.result.serviceId === 1).map((d) => d.result);
    const firstFail = r1.find((r) => !r.ok)!;
    expect(firstFail.kind).toBe('REGULAR');
    const s0 = Date.parse(firstFail.cycleAt);
    const s1 = nextCycleAt(1, new Date(s0), DEFAULT_SCHEDULE).getTime();
    expect(s1 - s0).toBe(MIN);
    const after = r1.filter((r) => Date.parse(r.startedAt) > s0);
    // reintento a +30 s; el de +60 s coincide con la franja s1 y la sustituye
    expect(after[0].kind).toBe('RETRY');
    expect(Date.parse(after[0].startedAt)).toBe(s0 + 30_000);
    expect(after[1].kind).toBe('RETRY');
    expect(Date.parse(after[1].startedAt)).toBe(s0 + 60_000);
    expect(Date.parse(after[1].cycleAt)).toBe(s1);
    expect(r1.filter((r) => r.kind === 'REGULAR' && Date.parse(r.cycleAt) === s1)).toEqual([]);

    const sig1 = h.signals().filter((s) => s.serviceId === 1).map((s) => s.type);
    expect(sig1).toEqual(['VERIFYING', 'CONFIRMED_FAILURE', 'RECOVERED']);
    for (const s of h.signals()) expect(s.id).toMatch(UUID);

    // ninguna franja de ningún servicio queda sin resultado (REGULAR o RETRY sustituto)
    const end = h.clock.now().getTime();
    for (const id of [1, 2]) {
      const cycles = new Set(h.delivered.filter((d) => d.result.serviceId === id && (d.result.kind === 'REGULAR' || d.result.kind === 'RETRY')).map((d) => Date.parse(d.result.cycleAt)));
      for (const c of expectedCycles(id, t0, end - 5000)) expect(cycles.has(c)).toBe(true);
    }
  });

  it('nunca más de 16 pruebas en vuelo', async () => {
    // 40 servicios con el mismo desfase (ids congruentes módulo 60) que tardan 5 s
    const services = Array.from({ length: 40 }, (_, k) => svc(k * 60 + 1));
    const h = setup({ start: LIMA_23H, services, behavior: () => ({ ms: 5000, ok: true }) });
    h.runner.start();
    await h.clock.advance(5 * MIN);
    h.runner.stop();
    expect(h.stats.maxInFlight).toBe(16);
    expect(h.stats.maxPerService).toBe(1);
  });

  it('50 servicios, franja de 1 min, 10 de ellos tardan 10 s y fallan: durante 10 min simulados cada servicio sano empieza su prueba regular a menos de 15 s de su cycleAt y ninguna franja se pierde', async () => {
    const services = Array.from({ length: 50 }, (_, k) => svc(k + 1));
    const failing = new Set(services.slice(0, 10).map((s) => s.id));
    const h = setup({
      start: LIMA_23H,
      services,
      behavior: (t) => (failing.has(t.id) ? { ms: 10_000, ok: false } : { ms: 1500, ok: true }),
    });
    const t0 = h.clock.now().getTime();
    h.runner.start();
    await h.clock.advance(10 * MIN);
    const tEnd = h.clock.now().getTime();
    await h.clock.advance(30_000); // deja terminar las que estaban en vuelo
    h.runner.stop();

    expect(h.stats.maxInFlight).toBeLessThanOrEqual(16);
    expect(h.stats.maxPerService).toBe(1);
    for (const s of services) {
      const exp = expectedCycles(s.id, t0, tEnd);
      expect(exp.length).toBeGreaterThanOrEqual(9);
      const mine = h.delivered.filter((d) => d.result.serviceId === s.id).map((d) => d.result);
      const covered = new Set(mine.filter((r) => r.kind === 'REGULAR' || r.kind === 'RETRY').map((r) => Date.parse(r.cycleAt)));
      for (const c of exp) expect(covered.has(c)).toBe(true);
      if (!failing.has(s.id)) {
        const regulars = mine.filter((r) => r.kind === 'REGULAR' && Date.parse(r.cycleAt) < tEnd);
        expect(regulars.map((r) => Date.parse(r.cycleAt))).toEqual(exp);
        for (const r of regulars) expect(Date.parse(r.startedAt) - Date.parse(r.cycleAt)).toBeLessThan(15_000);
      }
    }
    for (const id of failing) {
      expect(h.signals().filter((x) => x.serviceId === id).map((x) => x.type)).toEqual(['VERIFYING', 'CONFIRMED_FAILURE']);
    }
    expect(h.runner.states().get(1)).toBe('FAILED');
    expect(h.runner.states().get(11)).toBe('OK');
  });

  it('runNow durante una prueba en curso espera a que termine', async () => {
    const h = setup({ start: LIMA_23H, services: [svc(1)], behavior: () => ({ ms: 5000, ok: true }) });
    h.runner.start();
    const s0 = nextCycleAt(1, h.clock.now(), DEFAULT_SCHEDULE).getTime();
    await h.clock.advance(s0 - h.clock.now().getTime() + 1000); // regular en curso desde hace 1 s
    expect(h.stats.inFlight).toBe(1);
    h.runner.runNow(1, 'MANUAL', 7);
    h.runner.runNow(1, 'CROSS', 8);
    await h.clock.advance(20_000);
    h.runner.stop();
    expect(h.stats.maxPerService).toBe(1);
    const manual = h.starts.find((s) => s.kind === 'MANUAL')!;
    const cross = h.starts.find((s) => s.kind === 'CROSS')!;
    expect(manual.at).toBe(s0 + 5000);
    expect(manual.orderId).toBe(7);
    expect(cross.at).toBe(s0 + 10_000);
    const res = h.delivered.map((d) => d.result).filter((r) => r.kind !== 'REGULAR');
    expect(res.map((r) => [r.kind, r.orderId])).toEqual([['MANUAL', 7], ['CROSS', 8]]);
  });

  it('updateServices quita un servicio: no se le programan más pruebas', async () => {
    const h = setup({ start: LIMA_23H, services: [svc(1), svc(2)] });
    h.runner.start();
    await h.clock.advance(2 * MIN);
    expect(h.starts.filter((s) => s.id === 2).length).toBeGreaterThan(0);
    h.runner.updateServices([svc(1), svc(3)]);
    const cut = h.clock.now().getTime();
    await h.clock.advance(10 * MIN);
    h.runner.stop();
    expect(h.starts.filter((s) => s.id === 2 && s.at >= cut)).toEqual([]);
    expect(h.starts.filter((s) => s.id === 1 && s.at >= cut).length).toBeGreaterThanOrEqual(9);
    expect(h.starts.filter((s) => s.id === 3).length).toBeGreaterThanOrEqual(9);
    expect([...h.runner.states().keys()].sort()).toEqual([1, 3]);
  });

  it('updateServices quita un servicio en verificación: se descartan sus reintentos', async () => {
    let down = true;
    const h = setup({ start: LIMA_23H, services: [svc(1), svc(2)], behavior: (t) => ({ ms: 1000, ok: !(down && t.id === 2) }) });
    h.runner.start();
    const s0 = nextCycleAt(2, h.clock.now(), DEFAULT_SCHEDULE).getTime();
    await h.clock.advance(s0 - h.clock.now().getTime() + 5000);
    expect(h.runner.states().get(2)).toBe('VERIFYING');
    h.runner.updateServices([svc(1)]);
    down = false;
    await h.clock.advance(5 * MIN);
    h.runner.stop();
    expect(h.starts.filter((s) => s.id === 2 && s.at > s0)).toEqual([]);
  });

  it('referencias y la mitad de los destinos caen: una sola OFFICE_OUTAGE_START; al volver, una sola OFFICE_OUTAGE_END', async () => {
    let down = false;
    const references = [svc(1001), svc(1002)];
    const services = [svc(1), svc(2), svc(3), svc(4)];
    const h = setup({
      start: LIMA_23H,
      services,
      references,
      behavior: (t) => ({ ms: 500, ok: !(down && (t.id >= 1000 || t.id <= 2)) }),
    });
    h.runner.start();
    await h.clock.advance(4 * MIN);
    expect(h.runner.officeOutage()).toBe(false);
    down = true;
    await h.clock.advance(6 * MIN);
    expect(h.runner.officeOutage()).toBe(true);
    down = false;
    await h.clock.advance(6 * MIN);
    h.runner.stop();
    expect(h.runner.officeOutage()).toBe(false);

    const office = h.signals().filter((s) => s.type === 'OFFICE_OUTAGE_START' || s.type === 'OFFICE_OUTAGE_END');
    expect(office.map((s) => s.type)).toEqual(['OFFICE_OUTAGE_START', 'OFFICE_OUTAGE_END']);
    for (const s of office) {
      expect(s.serviceId).toBeNull();
      expect(s.id).toMatch(UUID);
      expect(Number.isNaN(Date.parse(s.at))).toBe(false);
    }
    // las referencias se prueban pero no se entregan como resultados ni tienen tracker
    expect(h.starts.some((s) => s.id === 1001)).toBe(true);
    expect(h.delivered.some((d) => d.result.serviceId >= 1000)).toBe(false);
    expect([...h.runner.states().keys()].sort()).toEqual([1, 2, 3, 4]);
    expect(h.signals().some((s) => s.serviceId !== null && s.serviceId >= 1000)).toBe(false);
  });

  it('sin referencias nunca emite señales de oficina', async () => {
    const h = setup({ start: LIMA_23H, services: [svc(1), svc(2)], behavior: () => ({ ms: 100, ok: false }) });
    h.runner.start();
    await h.clock.advance(5 * MIN);
    h.runner.stop();
    expect(h.signals().some((s) => s.type.startsWith('OFFICE'))).toBe(false);
    expect(h.runner.officeOutage()).toBe(false);
  });
});
