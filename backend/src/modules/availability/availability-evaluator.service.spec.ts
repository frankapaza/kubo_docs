import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AvailabilityEvaluatorService } from './availability-evaluator.service';
import { DIAGNOSIS_LABELS } from './domain/diagnose';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorIncidentEvent } from './entities/monitor-incident-event.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorMaintenance } from './entities/monitor-maintenance.entity';
import { MonitorOfficeOutage } from './entities/monitor-office-outage.entity';
import { MonitorProbeOrder } from './entities/monitor-probe-order.entity';
import { MonitorProbeSignal } from './entities/monitor-probe-signal.entity';
import { MonitorProbeState } from './entities/monitor-probe-state.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';

/* ------------------------------------------------------------------------ */
/* Doble en memoria del EntityManager: lo justo de la API de TypeORM que usa */
/* el evaluador (find/findOne/count/insert/update con FindOperators), con    */
/* las claves únicas de incidentes abiertos de la migración 032 y rollback   */
/* de la transacción si el callback lanza.                                   */
/* ------------------------------------------------------------------------ */

type Row = Record<string, any>;
type Entity = new () => any;

const AUTO_ID: Entity[] = [MonitorIncident, MonitorIncidentEvent, MonitorOfficeOutage, MonitorProbeOrder, MonitorProbeSignal];

const norm = (v: any) => (v instanceof Date ? v.getTime() : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
const eq = (a: any, b: any) => norm(a) === norm(b);
const cmp = (a: any, b: any) => (norm(a) < norm(b) ? -1 : norm(a) > norm(b) ? 1 : 0);

function test(value: any, cond: any): boolean {
  if (cond instanceof FindOperator) {
    const op = cond as FindOperator<any>;
    switch (op.type) {
      case 'isNull':
        return value === null || value === undefined;
      case 'in':
        return (op.value as any[]).some((v) => eq(value, v));
      case 'lessThan':
        return value != null && cmp(value, op.value) < 0;
      case 'lessThanOrEqual':
        return value != null && cmp(value, op.value) <= 0;
      case 'moreThan':
        return value != null && cmp(value, op.value) > 0;
      case 'moreThanOrEqual':
        return value != null && cmp(value, op.value) >= 0;
      case 'between': {
        const [a, b] = op.value as any[];
        return value != null && cmp(value, a) >= 0 && cmp(value, b) <= 0;
      }
      case 'not':
        return !test(value, op.value);
      default:
        throw new Error(`operador no soportado en el doble: ${op.type}`);
    }
  }
  return eq(value, cond);
}

const matches = (row: Row, where: any): boolean => {
  if (!where) return true;
  if (Array.isArray(where)) return where.some((w) => matches(row, w));
  return Object.entries(where).every(([k, v]) => v === undefined || test(row[k], v));
};

class FakeDb {
  tables = new Map<Entity, Row[]>();
  private seq = new Map<Entity, number>();
  readonly manager = { getRepository: (e: Entity) => this.repo(e) };
  readonly dataSource = {
    manager: this.manager,
    transaction: async (work: (m: any) => Promise<any>) => {
      const snap = new Map([...this.tables].map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
      try {
        return await work(this.manager);
      } catch (e) {
        this.tables = snap;
        throw e;
      }
    },
  };

  rows<T = Row>(e: Entity): T[] {
    if (!this.tables.has(e)) this.tables.set(e, []);
    return this.tables.get(e) as T[];
  }

  add(e: Entity, row: Row): Row {
    const r = { ...row };
    if (AUTO_ID.includes(e) && r.id === undefined) {
      const n = (this.seq.get(e) ?? 0) + 1;
      this.seq.set(e, n);
      r.id = n;
    } else if (AUTO_ID.includes(e)) {
      this.seq.set(e, Math.max(this.seq.get(e) ?? 0, r.id));
    }
    this.rows(e).push(r);
    this.checkUnique(e);
    return r;
  }

  private checkUnique(e: Entity) {
    if (e !== MonitorIncident) return;
    const open = this.rows(e).filter((r) => r.recoveredAt == null);
    const svc = open.filter((r) => r.serviceId != null).map((r) => Number(r.serviceId));
    const srv = open.filter((r) => r.serviceId == null).map((r) => Number(r.serverId));
    if (new Set(svc).size !== svc.length || new Set(srv).size !== srv.length) {
      throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
    }
  }

  private repo(e: Entity) {
    const find = async (opts: any = {}) => {
      let out = this.rows(e).filter((r) => matches(r, opts.where));
      if (opts.order) {
        const keys = Object.entries(opts.order) as [string, string][];
        out = [...out].sort((a, b) => {
          for (const [k, dir] of keys) {
            const c = cmp(a[k], b[k]);
            if (c !== 0) return dir.toUpperCase() === 'DESC' ? -c : c;
          }
          return 0;
        });
      }
      if (opts.take) out = out.slice(0, opts.take);
      return out.map((r) => ({ ...r }));
    };
    return {
      find,
      findOne: async (opts: any) => (await find({ ...opts, take: 1 }))[0] ?? null,
      findOneBy: async (where: any) => (await find({ where, take: 1 }))[0] ?? null,
      count: async (opts: any = {}) => (await find(opts)).length,
      insert: async (row: Row | Row[]) => {
        const list = Array.isArray(row) ? row : [row];
        const ids = list.map((r) => {
          const added = this.add(e, r);
          return { id: added.id };
        });
        return { identifiers: ids, raw: { affectedRows: ids.length } };
      },
      update: async (criteria: any, patch: Row) => {
        const where = typeof criteria === 'object' ? criteria : { id: criteria };
        const hit = this.rows(e).filter((r) => matches(r, where));
        const before = hit.map((r) => ({ ...r }));
        hit.forEach((r) => Object.assign(r, patch));
        try {
          this.checkUnique(e);
        } catch (err) {
          hit.forEach((r, i) => Object.assign(r, before[i]));
          throw err;
        }
        return { affected: hit.length };
      },
    };
  }
}

/* ------------------------------------------------------------------------ */

const T0 = new Date('2026-11-23T15:00:00.000Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const OFFICE = 1;
const DC = 2;

const setup = () => {
  const db = new FakeDb();
  db.add(MonitorProbe, { id: OFFICE, code: 'oficina-01', kind: 'OFFICE', clockSkewMs: 0 });
  db.add(MonitorProbe, { id: DC, code: 'kubo-01', kind: 'DATACENTER', clockSkewMs: 0 });
  db.add(MonitorServer, { id: 10, clientId: 3, name: 'srv-app', status: 'ACTIVE' });
  db.add(MonitorServer, { id: 11, clientId: 3, name: 'srv-db', status: 'ACTIVE' });
  const svc = (id: number, name: string, criticality: string, systemId: number | null = 50, serverId = 10) =>
    db.add(MonitorService, { id, serverId, systemId, name, protocol: 'TCP', criticality, status: 'ACTIVE', latencyThresholdMs: 1000 });
  svc(100, 'web HTTPS', 'HIGH');
  svc(101, 'TCP 443', 'MEDIUM');
  svc(102, 'api', 'LOW');
  svc(103, 'sql', 'LOW', null, 11);
  svc(104, 'smb', 'LOW', null, 11);

  let ticketSeq = 900;
  const tickets = {
    ensureTicket: jest.fn(async () => ({ id: ++ticketSeq, status: 'NUEVO' })),
    raisePriority: jest.fn(async () => undefined),
    reopenOrReplace: jest.fn(async (_inc: any, ticketId: number) => ({ id: ticketId, status: 'EN_ATENCION' })),
    comment: jest.fn(async () => undefined),
  };
  const evaluator = new AvailabilityEvaluatorService(db.dataSource as any, tickets as any);
  /** Última orden CROSS dirigida a kubo-01 para `serviceId` (la crea el evaluador). */
  const dcOrder = (serviceId: number) =>
    db.rows<MonitorProbeOrder>(MonitorProbeOrder).filter((o) => o.probeId === DC && o.serviceId === serviceId && o.kind === 'CROSS').pop()!;

  const signal = (probeId: number, type: string, serviceId: number | null, when: Date, over: Row = {}) =>
    db.add(MonitorProbeSignal, {
      uuid: `u-${Math.random()}`,
      probeId,
      serviceId,
      type,
      at: when,
      firstFailureAt: type === 'CONFIRMED_FAILURE' || type === 'VERIFYING' ? new Date(when.getTime() - 60_000) : null,
      receivedAt: when,
      processedAt: null,
      awaitingCrossUntil: null,
      crossOrderId: null,
      ...over,
    });
  let checkSeq = 0;
  const check = (probeId: number, serviceId: number, ok: boolean, when: Date, over: Row = {}) =>
    db.add(MonitorCheck, {
      probeId,
      id: `c-${++checkSeq}`,
      serviceId,
      kind: 'CROSS',
      cycleAt: when,
      startedAt: when,
      durationMs: 100,
      ok,
      errorCode: ok ? null : 'TIMEOUT',
      httpStatus: null,
      orderId: null,
      receivedAt: when,
      ...over,
    });
  const state = (probeId: number, serviceId: number, st: string) =>
    db.add(MonitorProbeState, { probeId, serviceId, state: st, lastCheckAt: null, lastOk: null, lastLatencyMs: null, updatedAt: T0 });

  const incidents = () => db.rows<MonitorIncident>(MonitorIncident);
  const events = (incidentId?: number) =>
    db.rows<MonitorIncidentEvent>(MonitorIncidentEvent).filter((e) => incidentId === undefined || e.incidentId === incidentId);
  const sig = (id: number) => db.rows<MonitorProbeSignal>(MonitorProbeSignal).find((s) => s.id === id)!;

  /** Oficina confirma el fallo de `serviceId` y el servidor contesta el cruce con `crossOk`. */
  const officeDownWithCross = async (serviceId: number, when: Date, crossOk: boolean) => {
    signal(OFFICE, 'CONFIRMED_FAILURE', serviceId, when);
    await evaluator.tick(at((when.getTime() - T0.getTime()) / 1000 + 1));
    check(DC, serviceId, crossOk, new Date(when.getTime() + 10_000), { orderId: dcOrder(serviceId)?.id ?? null });
    await evaluator.tick(new Date(when.getTime() + 20_000));
  };

  return { db, evaluator, tickets, dcOrder, signal, check, state, incidents, events, sig, officeDownWithCross };
};

describe('AvailabilityEvaluatorService', () => {
  it('HTTPS caído con TCP operativo: solo el servicio HTTPS abre incidente y ticket', async () => {
    const t = setup();
    t.signal(OFFICE, 'CONFIRMED_FAILURE', 100, T0);
    t.check(OFFICE, 101, true, T0, { kind: 'REGULAR' });
    await t.evaluator.tick(at(1));

    expect(t.dcOrder(100)).toMatchObject({ probeId: DC, serviceId: 100, kind: 'CROSS', takenAt: null });
    expect(t.incidents()).toHaveLength(0);
    const s = t.db.rows<MonitorProbeSignal>(MonitorProbeSignal)[0];
    expect(s.processedAt).toBeNull();
    expect(s.awaitingCrossUntil).toEqual(at(121));

    t.check(DC, 100, false, at(10), { orderId: t.dcOrder(100).id });
    await t.evaluator.tick(at(20));

    expect(t.incidents()).toHaveLength(1);
    const inc = t.incidents()[0];
    expect(inc).toMatchObject({ serviceId: 100, serverId: 10, kind: 'DOWN', parentId: null, recoveredAt: null });
    expect(inc.confirmedAt).toEqual(T0);
    expect(inc.firstFailureAt).toEqual(at(-60));
    expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(1);
    expect(t.tickets.ensureTicket).toHaveBeenCalledWith(expect.objectContaining({ id: inc.id }), {
      clientId: 3,
      systemId: 50,
      criticality: 'HIGH',
      serviceNames: ['web HTTPS'],
      serverName: 'srv-app',
      diagnosis: DIAGNOSIS_LABELS.DOWN,
    });
    expect(inc.ticketId).toBe(901);
    expect(t.db.rows<MonitorProbeSignal>(MonitorProbeSignal)[0].processedAt).toEqual(at(20));
    expect(t.events(inc.id).map((e) => e.type)).toContain('OPENED');
    expect(t.db.rows<MonitorProbeState>(MonitorProbeState).find((r) => r.probeId === OFFICE && r.serviceId === 100)?.state).toBe('FAILED');
  });

  it('ROUTE: la oficina confirma y el servidor responde; luego el servidor confirma -> mismo incidente pasa a DOWN, sin ticket nuevo', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, true);
    expect(t.incidents()).toHaveLength(1);
    const id = t.incidents()[0].id;
    expect(t.incidents()[0].kind).toBe('ROUTE');
    expect(t.tickets.ensureTicket).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ diagnosis: DIAGNOSIS_LABELS.ROUTE }));

    t.signal(DC, 'CONFIRMED_FAILURE', 100, at(300));
    await t.evaluator.tick(at(301));

    expect(t.incidents()).toHaveLength(1);
    expect(t.incidents()[0]).toMatchObject({ id, kind: 'DOWN' });
    expect(t.events(id).map((e) => e.type)).toContain('UPGRADED_TO_DOWN');
    expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(1);
    expect(t.tickets.comment).toHaveBeenCalledWith(901, expect.stringContaining('DOWN'), expect.objectContaining({ incidentId: id }));
    expect(t.db.rows(MonitorProbeOrder)).toHaveLength(1); // solo la del primer cruce
  });

  it('cruce que no llega: a los 2 min se abre ROUTE con la información disponible', async () => {
    const t = setup();
    t.signal(OFFICE, 'CONFIRMED_FAILURE', 100, T0);
    await t.evaluator.tick(at(1));
    await t.evaluator.tick(at(120));
    expect(t.incidents()).toHaveLength(0);
    await t.evaluator.tick(at(122));
    expect(t.incidents()).toHaveLength(1);
    expect(t.incidents()[0].kind).toBe('ROUTE');
    expect(t.tickets.ensureTicket).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ diagnosis: DIAGNOSIS_LABELS.ROUTE_PENDING }),
    );
  });

  it('servidor confirma y oficina responde -> ningún incidente, ningún ticket', async () => {
    const t = setup();
    const s = t.signal(DC, 'CONFIRMED_FAILURE', 100, T0);
    await t.evaluator.tick(at(1));

    const orders = t.db.rows<MonitorProbeOrder>(MonitorProbeOrder);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ probeId: OFFICE, serviceId: 100, kind: 'CROSS' });
    expect(t.sig(s.id).crossOrderId).toBe(orders[0].id);

    t.check(OFFICE, 100, true, at(20), { orderId: orders[0].id });
    await t.evaluator.tick(at(30));

    expect(t.incidents()).toHaveLength(0);
    expect(t.tickets.ensureTicket).not.toHaveBeenCalled();
    expect(t.sig(s.id).processedAt).toEqual(at(30));
  });

  it('servidor confirma y la oficina también falla el cruce -> DOWN', async () => {
    const t = setup();
    t.signal(DC, 'CONFIRMED_FAILURE', 100, T0);
    await t.evaluator.tick(at(1));
    const order = t.db.rows<MonitorProbeOrder>(MonitorProbeOrder)[0];
    t.check(OFFICE, 100, false, at(20), { orderId: order.id });
    await t.evaluator.tick(at(30));
    expect(t.incidents()).toHaveLength(1);
    expect(t.incidents()[0].kind).toBe('DOWN');
  });

  it('caída de oficina: START y luego CONFIRMED_FAILURE de 5 servicios -> cero incidentes, una fila de caída', async () => {
    const t = setup();
    for (const id of [100, 101, 102, 103, 104]) t.check(OFFICE, id, false, at(-30), { kind: 'REGULAR' });
    t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, T0);
    for (const id of [100, 101, 102, 103, 104]) t.signal(OFFICE, 'CONFIRMED_FAILURE', id, at(30));
    await t.evaluator.tick(at(40));
    await t.evaluator.tick(at(400));

    expect(t.incidents()).toHaveLength(0);
    const outages = t.db.rows<MonitorOfficeOutage>(MonitorOfficeOutage);
    expect(outages).toHaveLength(1);
    expect(outages[0]).toMatchObject({ probeId: OFFICE, startedAt: T0, endedAt: null, affectedServices: 5 });
    expect(t.db.rows(MonitorProbeOrder)).toHaveLength(0);
    expect(t.db.rows<MonitorProbeSignal>(MonitorProbeSignal).every((s) => s.processedAt !== null)).toBe(true);
    expect(t.tickets.ensureTicket).not.toHaveBeenCalled();

    t.signal(OFFICE, 'OFFICE_OUTAGE_END', null, at(600));
    await t.evaluator.tick(at(601));
    expect(t.db.rows<MonitorOfficeOutage>(MonitorOfficeOutage)[0].endedAt).toEqual(at(600));
  });

  it('caída de oficina que llega en el mismo lote DESPUÉS del fallo confirmado: el fallo se descarta al resolver', async () => {
    const t = setup();
    t.signal(OFFICE, 'CONFIRMED_FAILURE', 100, T0);
    t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, at(5));
    await t.evaluator.tick(at(6));
    await t.evaluator.tick(at(200));
    expect(t.incidents()).toHaveLength(0);
    expect(t.tickets.ensureTicket).not.toHaveBeenCalled();
  });

  it('servidor confirma durante una caída de oficina -> DOWN sin esperar el cruce', async () => {
    const t = setup();
    t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, T0);
    t.signal(DC, 'CONFIRMED_FAILURE', 100, at(30));
    await t.evaluator.tick(at(31));
    expect(t.incidents()).toHaveLength(1);
    expect(t.incidents()[0].kind).toBe('DOWN');
    expect(t.db.rows(MonitorProbeOrder)).toHaveLength(0);
  });

  it('dos servicios del mismo servidor en 2 min -> un padre, un ticket, prioridad del más crítico', async () => {
    const t = setup();
    await t.officeDownWithCross(101, T0, false); // MEDIUM primero
    await t.officeDownWithCross(100, at(120), false); // HIGH a los 2 min

    const all = t.incidents();
    const parent = all.find((i) => i.serviceId === null)!;
    expect(parent).toMatchObject({ serverId: 10, kind: 'DOWN', ticketId: 901, parentId: null, recoveredAt: null });
    expect(all.filter((i) => i.serviceId !== null).every((i) => i.parentId === parent.id)).toBe(true);
    expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(1);
    expect(t.tickets.raisePriority).toHaveBeenCalledWith(901, 'HIGH');
    expect(t.tickets.comment).toHaveBeenCalledWith(901, expect.stringMatching(/TCP 443.*web HTTPS|web HTTPS.*TCP 443/), expect.anything());

    // Un tercero más tarde se suma al padre.
    await t.officeDownWithCross(102, at(1200), false);
    const third = t.incidents().find((i) => i.serviceId === 102)!;
    expect(third.parentId).toBe(parent.id);
    expect(third.ticketId).toBe(901);
    expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(1);

    // Recuperación: el padre se cierra con el último hijo y comenta una sola vez.
    t.tickets.comment.mockClear();
    for (const id of [100, 101, 102]) t.state(DC, id, 'OK');
    t.signal(OFFICE, 'RECOVERED', 100, at(2000));
    t.signal(OFFICE, 'RECOVERED', 101, at(2000));
    await t.evaluator.tick(at(2001));
    expect(t.incidents().find((i) => i.id === parent.id)!.recoveredAt).toBeNull();
    t.signal(OFFICE, 'RECOVERED', 102, at(2100));
    await t.evaluator.tick(at(2101));
    expect(t.incidents().find((i) => i.id === parent.id)!).toMatchObject({ recoveredAt: at(2100), closeReason: 'RECOVERED' });
    expect(t.tickets.comment).toHaveBeenCalledTimes(1);
    expect(t.tickets.comment).toHaveBeenCalledWith(901, expect.stringContaining('36 min'), expect.anything());
  });

  it('recae a los 10 min de recuperado -> mismo incidente y reopenOrReplace', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, false);
    const inc = t.incidents()[0];
    t.state(DC, 100, 'OK');
    t.signal(OFFICE, 'RECOVERED', 100, at(600));
    await t.evaluator.tick(at(601));
    expect(t.incidents()[0]).toMatchObject({ recoveredAt: at(600), closeReason: 'RECOVERED' });
    expect(t.events(inc.id).map((e) => e.type)).toContain('RECOVERED');
    expect(t.tickets.comment).toHaveBeenCalledWith(901, expect.stringContaining('11 min'), expect.anything());

    await t.officeDownWithCross(100, at(1200), false);
    expect(t.incidents()).toHaveLength(1);
    expect(t.incidents()[0]).toMatchObject({ id: inc.id, recoveredAt: null, closeReason: null, kind: 'DOWN' });
    expect(t.events(inc.id).map((e) => e.type)).toContain('REOPENED');
    expect(t.tickets.reopenOrReplace).toHaveBeenCalledWith(
      expect.objectContaining({ id: inc.id }),
      901,
      expect.objectContaining({ serviceNames: ['web HTTPS'] }),
    );
    expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(1);
  });

  it('reabrir con ticket reemplazado guarda el ticket nuevo', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, false);
    t.state(DC, 100, 'OK');
    t.signal(OFFICE, 'RECOVERED', 100, at(600));
    await t.evaluator.tick(at(601));
    t.tickets.reopenOrReplace.mockResolvedValueOnce({ id: 777, status: 'NUEVO' });
    await t.officeDownWithCross(100, at(1200), false);
    expect(t.incidents()[0].ticketId).toBe(777);
  });

  it('DOWN no se cierra mientras el servidor sigue FAILED', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, false);
    t.state(DC, 100, 'FAILED');
    t.signal(OFFICE, 'RECOVERED', 100, at(600));
    await t.evaluator.tick(at(601));
    expect(t.incidents()[0].recoveredAt).toBeNull();
    t.signal(DC, 'RECOVERED', 100, at(700));
    await t.evaluator.tick(at(701));
    expect(t.incidents()[0].recoveredAt).toEqual(at(700));
  });

  it('DOWN: la oficina se recupera con el servidor VERIFYING; el reintento del servidor pasa (TRANSIENT_FAILURE) -> se cierra una vez', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, false);
    const inc = t.incidents()[0];
    t.state(DC, 100, 'VERIFYING');
    t.tickets.comment.mockClear();
    t.signal(OFFICE, 'RECOVERED', 100, at(600));
    await t.evaluator.tick(at(601));
    expect(t.incidents()[0].recoveredAt).toBeNull();
    t.signal(DC, 'TRANSIENT_FAILURE', 100, at(630));
    await t.evaluator.tick(at(631));
    expect(t.incidents()[0]).toMatchObject({ recoveredAt: at(630), closeReason: 'RECOVERED' });
    expect(t.events(inc.id).filter((e) => e.type === 'RECOVERED')).toHaveLength(1);
    expect(t.tickets.comment).toHaveBeenCalledTimes(1);
    await t.evaluator.tick(at(700));
    expect(t.tickets.comment).toHaveBeenCalledTimes(1);
  });

  it('espejo: el servidor se recupera con la oficina VERIFYING; la oficina pasa el reintento -> se cierra una vez', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, false);
    const inc = t.incidents()[0];
    t.state(DC, 100, 'FAILED');
    t.signal(OFFICE, 'RECOVERED', 100, at(500)); // oficina OK, servidor FAILED: sigue abierto
    t.signal(OFFICE, 'VERIFYING', 100, at(550)); // la oficina vuelve a dudar
    t.signal(DC, 'RECOVERED', 100, at(600)); // servidor OK, oficina VERIFYING: sigue abierto
    await t.evaluator.tick(at(601));
    expect(t.incidents()[0].recoveredAt).toBeNull();
    t.tickets.comment.mockClear();
    t.signal(OFFICE, 'TRANSIENT_FAILURE', 100, at(610));
    await t.evaluator.tick(at(611));
    expect(t.incidents()[0]).toMatchObject({ recoveredAt: at(610), closeReason: 'RECOVERED' });
    expect(t.events(inc.id).filter((e) => e.type === 'RECOVERED')).toHaveLength(1);
    expect(t.tickets.comment).toHaveBeenCalledTimes(1);
  });

  it('DEGRADATION_CLEARED de la otra sonda también cierra el DOWN', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, false);
    t.signal(DC, 'DEGRADED', 100, at(400));
    t.signal(OFFICE, 'RECOVERED', 100, at(500));
    await t.evaluator.tick(at(501));
    expect(t.incidents()[0].recoveredAt).toBeNull();
    t.tickets.comment.mockClear();
    t.signal(DC, 'DEGRADATION_CLEARED', 100, at(600));
    await t.evaluator.tick(at(601));
    expect(t.incidents()[0]).toMatchObject({ recoveredAt: at(600), closeReason: 'RECOVERED' });
    expect(t.tickets.comment).toHaveBeenCalledTimes(1);
  });

  it('el barrido de tickets usa el diagnóstico real guardado al abrir', async () => {
    const t = setup();
    t.tickets.ensureTicket.mockRejectedValueOnce(new ServiceUnavailableException('caído'));
    t.signal(OFFICE, 'CONFIRMED_FAILURE', 100, T0);
    await t.evaluator.tick(at(1));
    await t.evaluator.tick(at(122)); // vence el cruce: ROUTE pendiente, el ticket falla con 5xx
    expect(t.incidents()[0].ticketId).toBeNull();
    await t.evaluator.tick(at(132)); // primera espera del barrido tras un 5xx: 10 s
    expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(2);
    expect(t.tickets.ensureTicket).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ diagnosis: DIAGNOSIS_LABELS.ROUTE_PENDING }),
    );
    expect(t.incidents()[0].ticketId).toBe(901);
  });

  it('el barrido tras subir a DOWN usa el texto de DOWN, no el ROUTE guardado', async () => {
    const t = setup();
    t.tickets.ensureTicket.mockRejectedValueOnce(new ServiceUnavailableException('caído'));
    await t.officeDownWithCross(100, T0, true); // ROUTE, ticket falla
    t.signal(DC, 'CONFIRMED_FAILURE', 100, at(300));
    await t.evaluator.tick(at(301)); // sube a DOWN; el barrido reintenta
    expect(t.tickets.ensureTicket).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ diagnosis: DIAGNOSIS_LABELS.DOWN }),
    );
  });

  it('tick procesado dos veces seguidas (reinicio) -> no duplica incidentes ni tickets', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, false);
    await t.evaluator.tick(at(30));
    // Reinicio a medias: la señal vuelve a quedar pendiente.
    for (const s of t.db.rows<MonitorProbeSignal>(MonitorProbeSignal)) s.processedAt = null;
    await t.evaluator.tick(at(40));
    await t.evaluator.tick(at(41));
    expect(t.incidents()).toHaveLength(1);
    expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(1);
    expect(t.events().filter((e) => e.type === 'OPENED')).toHaveLength(1);
  });

  it('incidente abierto sin ticket_id -> ensureTicket en el siguiente tick', async () => {
    const t = setup();
    t.db.add(MonitorIncident, {
      serviceId: 100, serverId: 10, parentId: null, kind: 'ROUTE', firstFailureAt: T0, confirmedAt: T0,
      recoveredAt: null, closeReason: null, ticketId: null,
    });
    await t.evaluator.tick(at(5));
    expect(t.tickets.ensureTicket).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 100 }),
      expect.objectContaining({ diagnosis: DIAGNOSIS_LABELS.ROUTE, criticality: 'HIGH' }),
    );
    expect(t.incidents()[0].ticketId).toBe(901);
  });

  describe('ventanas de mantenimiento', () => {
    const maintenance = (t: ReturnType<typeof setup>, over: Row) =>
      t.db.add(MonitorMaintenance, { id: 1, serverId: null, serviceId: null, startsAt: at(-600), endsAt: at(600), reason: 'Parche mensual', createdBy: 7, ...over });

    it('DOWN confirmado durante una ventana activa del servidor: sin ticket y un solo MAINTENANCE_SUPPRESSED aunque el barrido corra 3 veces', async () => {
      const t = setup();
      maintenance(t, { serverId: 10 });
      await t.officeDownWithCross(100, T0, false);
      await t.evaluator.tick(at(30));
      await t.evaluator.tick(at(35));
      await t.evaluator.tick(at(40));
      const inc = t.incidents()[0];
      expect(inc).toMatchObject({ kind: 'DOWN', recoveredAt: null, ticketId: null });
      expect(t.tickets.ensureTicket).not.toHaveBeenCalled();
      const suppressed = t.events(inc.id).filter((e) => e.type === 'MAINTENANCE_SUPPRESSED');
      expect(suppressed).toHaveLength(1);
      expect(suppressed[0].detail).toMatchObject({ maintenanceId: 1, reason: 'Parche mensual' });
    });

    it('al pasar now por endsAt con el incidente abierto, el barrido crea el ticket', async () => {
      const t = setup();
      maintenance(t, { serviceId: 100 });
      await t.officeDownWithCross(100, T0, false);
      await t.evaluator.tick(at(599));
      expect(t.tickets.ensureTicket).not.toHaveBeenCalled();
      await t.evaluator.tick(at(600));
      expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(1);
      expect(t.incidents()[0].ticketId).toBe(901);
    });

    it('una ventana de otro servicio no suprime el ticket', async () => {
      const t = setup();
      maintenance(t, { serviceId: 101 });
      await t.officeDownWithCross(100, T0, false);
      expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(1);
      expect(t.events().some((e) => e.type === 'MAINTENANCE_SUPPRESSED')).toBe(false);
    });

    it('las ventanas activas se leen una vez por tick, no por incidente', async () => {
      const t = setup();
      maintenance(t, { serverId: 10 });
      maintenance(t, { id: 2, serverId: 11 });
      for (const [serviceId, serverId] of [[100, 10], [103, 11]]) {
        t.db.add(MonitorIncident, {
          serviceId, serverId, parentId: null, kind: 'DOWN', firstFailureAt: T0, confirmedAt: T0, recoveredAt: null, closeReason: null, ticketId: null,
        });
      }
      const repo = t.db.manager.getRepository;
      let reads = 0;
      (t.db.manager as any).getRepository = (e: any) => {
        const r = repo(e);
        if (e !== MonitorMaintenance) return r;
        return { ...r, find: async (o: any) => (reads++, r.find(o)) };
      };
      await t.evaluator.tick(at(5));
      expect(reads).toBe(1);
      expect(t.tickets.ensureTicket).not.toHaveBeenCalled();
      expect(t.events().filter((e) => e.type === 'MAINTENANCE_SUPPRESSED')).toHaveLength(2);
    });
  });

  it('ensureTicket con 5xx se reintenta en el siguiente tick', async () => {
    const t = setup();
    t.tickets.ensureTicket.mockRejectedValueOnce(new ServiceUnavailableException('caído'));
    await t.officeDownWithCross(100, T0, false);
    expect(t.incidents()[0].ticketId).toBeNull();
    await t.evaluator.tick(at(60));
    expect(t.incidents()[0].ticketId).toBe(901);
    expect(t.events().some((e) => e.type === 'TICKET_NOT_CREATED')).toBe(false);
  });

  it('ensureTicket con 5xx persistente: el barrido reintenta con espera exponencial por incidente (tope 10 min), una línea por intento', async () => {
    const t = setup();
    t.tickets.ensureTicket.mockRejectedValue(new ServiceUnavailableException('caído'));
    const warn = jest.spyOn((t.evaluator as any).logger, 'warn').mockImplementation(() => undefined);
    await t.officeDownWithCross(100, T0, false); // primer intento a los 20 s
    const times = [20];
    for (let sec = 25; sec <= 4000; sec += 5) {
      const before = t.tickets.ensureTicket.mock.calls.length;
      await t.evaluator.tick(at(sec));
      if (t.tickets.ensureTicket.mock.calls.length > before) times.push(sec);
    }
    const gaps = times.slice(1).map((x, i) => x - times[i]);
    expect(gaps.slice(0, 6)).toEqual([10, 20, 40, 80, 160, 320]);
    expect(gaps.slice(6).every((g) => g === 600)).toBe(true);
    expect(times.length).toBeLessThan(15);
    const ticketWarns = warn.mock.calls.filter(([m]) => String(m).includes('ENSURE_TICKET'));
    expect(ticketWarns).toHaveLength(times.length);

    // Cuando la central de tickets vuelve, se crea en el siguiente intento programado.
    t.tickets.ensureTicket.mockResolvedValue({ id: 777, status: 'NUEVO' } as any);
    await t.evaluator.tick(at(4000 + 600));
    expect(t.incidents()[0].ticketId).toBe(777);
  });

  it('ensureTicket con 4xx registra TICKET_NOT_CREATED y deja de reintentar', async () => {
    const t = setup();
    t.tickets.ensureTicket.mockRejectedValue(new BadRequestException({ code: 'SISTEMA_AJENO', message: 'Sistema de otro cliente' }));
    await t.officeDownWithCross(100, T0, false);
    const inc = t.incidents()[0];
    const failed = t.events(inc.id).filter((e) => e.type === 'TICKET_NOT_CREATED');
    expect(failed).toHaveLength(1);
    expect(failed[0].detail).toMatchObject({ status: 400 });
    expect(JSON.stringify(failed[0].detail)).toContain('Sistema de otro cliente');
    await t.evaluator.tick(at(60));
    await t.evaluator.tick(at(90));
    expect(t.tickets.ensureTicket).toHaveBeenCalledTimes(1);
    expect(t.events(inc.id).filter((e) => e.type === 'TICKET_NOT_CREATED')).toHaveLength(1);

    // Cambia de tipo (ROUTE -> DOWN no aplica aquí; reabrir sí): tras reabrir vuelve a intentarlo.
    t.tickets.ensureTicket.mockResolvedValue({ id: 950, status: 'NUEVO' } as any);
    t.state(DC, 100, 'OK');
    t.signal(OFFICE, 'RECOVERED', 100, at(600));
    await t.evaluator.tick(at(601));
    await t.officeDownWithCross(100, at(900), false);
    expect(t.incidents()[0].ticketId).toBe(950);
  });

  it('closeForPause -> cierra sin RECOVERED, con evento «Servicio pausado» y comentario', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, false);
    const inc = t.incidents()[0];
    await t.evaluator.closeForPause([100], 7);
    expect(t.incidents()[0]).toMatchObject({ closeReason: 'SERVICE_PAUSED' });
    expect(t.incidents()[0].recoveredAt).not.toBeNull();
    const types = t.events(inc.id).map((e) => e.type);
    expect(types).toContain('SERVICE_PAUSED');
    expect(types).not.toContain('RECOVERED');
    const ev = t.events(inc.id).find((e) => e.type === 'SERVICE_PAUSED')!;
    expect(ev.authorUserId).toBe(7);
    expect(JSON.stringify(ev.detail)).toContain('Servicio pausado');
    expect(t.tickets.comment).toHaveBeenCalledWith(901, expect.stringContaining('pausado'), expect.anything());
  });

  it('closeForPause sin incidentes abiertos no hace nada', async () => {
    const t = setup();
    await t.evaluator.closeForPause([100], 7);
    expect(t.tickets.comment).not.toHaveBeenCalled();
  });

  it('recuperación con ticket RESUELTO -> el comentario se agrega igual (decisión 20)', async () => {
    const t = setup();
    await t.officeDownWithCross(100, T0, true); // ROUTE
    // El agente resolvió el ticket: el evaluador no lo consulta ni cambia de comportamiento.
    t.signal(OFFICE, 'RECOVERED', 100, at(300));
    await t.evaluator.tick(at(301));
    expect(t.incidents()[0]).toMatchObject({ closeReason: 'RECOVERED', recoveredAt: at(300) });
    expect(t.tickets.comment).toHaveBeenCalledWith(901, expect.stringContaining('recuper'), expect.anything());
    expect(t.tickets.reopenOrReplace).not.toHaveBeenCalled();
  });

  it('degradación de la oficina abre y cierra un DEGRADED sin ticket; CLEARED antes de VERIFYING', async () => {
    const t = setup();
    t.signal(OFFICE, 'DEGRADED', 100, T0);
    await t.evaluator.tick(at(1));
    expect(t.incidents()).toHaveLength(1);
    expect(t.incidents()[0]).toMatchObject({ kind: 'DEGRADED', serviceId: 100, recoveredAt: null });
    expect(t.tickets.ensureTicket).not.toHaveBeenCalled();
    expect(t.db.rows<MonitorProbeState>(MonitorProbeState)[0].state).toBe('DEGRADED');

    t.signal(OFFICE, 'DEGRADATION_CLEARED', 100, at(300));
    t.signal(OFFICE, 'VERIFYING', 100, at(300));
    await t.evaluator.tick(at(301));
    expect(t.incidents()[0]).toMatchObject({ recoveredAt: at(300), closeReason: 'RECOVERED' });
    expect(t.db.rows<MonitorProbeState>(MonitorProbeState)[0].state).toBe('VERIFYING');
    expect(t.tickets.ensureTicket).not.toHaveBeenCalled();
  });

  it('VERIFYING y TRANSIENT_FAILURE solo actualizan el estado de la sonda', async () => {
    const t = setup();
    t.state(OFFICE, 100, 'OK');
    t.signal(OFFICE, 'VERIFYING', 100, T0);
    await t.evaluator.tick(at(1));
    expect(t.db.rows<MonitorProbeState>(MonitorProbeState)[0].state).toBe('VERIFYING');
    t.signal(OFFICE, 'TRANSIENT_FAILURE', 100, at(30));
    await t.evaluator.tick(at(31));
    expect(t.db.rows<MonitorProbeState>(MonitorProbeState)[0].state).toBe('OK');
    expect(t.incidents()).toHaveLength(0);
  });

  it('una señal en espera de cruce retiene las siguientes de la misma sonda y servicio', async () => {
    const t = setup();
    t.signal(OFFICE, 'CONFIRMED_FAILURE', 100, T0);
    const rec = t.signal(OFFICE, 'RECOVERED', 100, at(5));
    const other = t.signal(OFFICE, 'VERIFYING', 101, at(5));
    await t.evaluator.tick(at(6));
    expect(t.sig(rec.id).processedAt).toBeNull();
    expect(t.sig(other.id).processedAt).toEqual(at(6));
    t.check(DC, 100, false, at(10), { orderId: t.dcOrder(100).id });
    t.state(DC, 100, 'OK');
    await t.evaluator.tick(at(20));
    // Primero abre, luego la recuperación lo cierra, en orden de id.
    expect(t.incidents()).toHaveLength(1);
    expect(t.incidents()[0].recoveredAt).toEqual(at(5));
    expect(t.sig(rec.id).processedAt).toEqual(at(20));
  });

  it('un servicio pausado no abre incidente', async () => {
    const t = setup();
    t.db.rows<MonitorService>(MonitorService).find((s) => s.id === 100)!.status = 'PAUSED';
    await t.officeDownWithCross(100, T0, false);
    expect(t.incidents()).toHaveLength(0);
    expect(t.db.rows<MonitorProbeSignal>(MonitorProbeSignal)[0].processedAt).not.toBeNull();
  });

  it('un error en una señal no detiene las demás', async () => {
    const t = setup();
    t.signal(OFFICE, 'CONFIRMED_FAILURE', 999, T0); // servicio inexistente
    const ok = t.signal(OFFICE, 'VERIFYING', 101, T0);
    await t.evaluator.tick(at(1));
    expect(t.sig(ok.id).processedAt).toEqual(at(1));
  });

  describe('resincronización tras reiniciar una sonda (STATE_SYNC y caída de oficina)', () => {
    const stateOf = (t: ReturnType<typeof setup>, probeId: number, serviceId: number) =>
      t.db.rows<MonitorProbeState>(MonitorProbeState).filter((r) => r.probeId === probeId && r.serviceId === serviceId).pop()?.state;

    it('kubo-01 reinicia con el DOWN abierto y el servicio ya bien: su STATE_SYNC pone OK y cierra el incidente con comentario', async () => {
      const t = setup();
      await t.officeDownWithCross(100, T0, false);
      t.state(DC, 100, 'FAILED');
      t.signal(OFFICE, 'RECOVERED', 100, at(500));
      await t.evaluator.tick(at(501));
      expect(t.incidents()[0].recoveredAt).toBeNull(); // el servidor sigue FAILED
      t.tickets.comment.mockClear();

      t.signal(DC, 'STATE_SYNC', 100, at(900));
      await t.evaluator.tick(at(901));
      expect(stateOf(t, DC, 100)).toBe('OK');
      expect(t.incidents()[0]).toMatchObject({ recoveredAt: at(900), closeReason: 'RECOVERED' });
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
    });

    it('la oficina reinicia con un DEGRADED abierto: su STATE_SYNC lo cierra', async () => {
      const t = setup();
      t.signal(OFFICE, 'DEGRADED', 100, T0);
      await t.evaluator.tick(at(1));
      t.signal(OFFICE, 'STATE_SYNC', 100, at(600));
      await t.evaluator.tick(at(601));
      expect(t.incidents()[0]).toMatchObject({ kind: 'DEGRADED', recoveredAt: at(600) });
      expect(stateOf(t, OFFICE, 100)).toBe('OK');
    });

    it('STATE_SYNC con todo ya en OK no hace nada más que fijar el estado', async () => {
      const t = setup();
      t.state(OFFICE, 100, 'OK');
      const s = t.signal(OFFICE, 'STATE_SYNC', 100, T0);
      await t.evaluator.tick(at(1));
      expect(t.sig(s.id).processedAt).toEqual(at(1));
      expect(t.incidents()).toHaveLength(0);
      expect(stateOf(t, OFFICE, 100)).toBe('OK');
    });

    it('OFFICE_OUTAGE_END sin caída abierta y START con una ya abierta no hacen nada', async () => {
      const t = setup();
      t.signal(OFFICE, 'OFFICE_OUTAGE_END', null, T0);
      await t.evaluator.tick(at(1));
      expect(t.db.rows(MonitorOfficeOutage)).toHaveLength(0);
      t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, at(10));
      t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, at(400)); // el runner nuevo la vuelve a declarar
      await t.evaluator.tick(at(401));
      expect(t.db.rows<MonitorOfficeOutage>(MonitorOfficeOutage)).toHaveLength(1);
      t.signal(OFFICE, 'OFFICE_OUTAGE_END', null, at(700));
      await t.evaluator.tick(at(701));
      expect(t.db.rows<MonitorOfficeOutage>(MonitorOfficeOutage)[0].endedAt).toEqual(at(700));
    });
  });

  describe('reconciliación central (red de seguridad sin señales)', () => {
    const stateOf = (t: ReturnType<typeof setup>, probeId: number, serviceId: number) =>
      t.db.rows<MonitorProbeState>(MonitorProbeState).filter((r) => r.probeId === probeId && r.serviceId === serviceId).pop()?.state;

    /** DOWN abierto con la oficina ya OK y kubo-01 colgado en FAILED desde at(400). */
    const stuckDc = async () => {
      const t = setup();
      await t.officeDownWithCross(100, T0, false);
      t.signal(DC, 'CONFIRMED_FAILURE', 100, at(390));
      t.signal(OFFICE, 'RECOVERED', 100, at(395));
      await t.evaluator.tick(at(400));
      expect(stateOf(t, DC, 100)).toBe('FAILED');
      expect(t.incidents()[0].recoveredAt).toBeNull();
      t.tickets.comment.mockClear();
      return t;
    };

    it('kubo-01 FAILED con dos comprobaciones correctas recibidas después (sin señal): pasa a OK y cierra el DOWN', async () => {
      const t = await stuckDc();
      t.check(DC, 100, true, at(600), { kind: 'REGULAR' });
      t.check(DC, 100, true, at(900), { kind: 'REGULAR' });
      await t.evaluator.tick(at(905));
      expect(stateOf(t, DC, 100)).toBe('OK');
      expect(t.incidents()[0]).toMatchObject({ recoveredAt: at(900), closeReason: 'RECOVERED' });
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
      await t.evaluator.tick(at(1000));
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
    });

    it('no reconcilia con una sola correcta, con la última fallida, ni con comprobaciones anteriores al cambio de estado', async () => {
      const t = await stuckDc();
      t.check(DC, 100, true, at(300), { kind: 'REGULAR' }); // anterior al FAILED
      t.check(DC, 100, true, at(600), { kind: 'REGULAR' });
      await t.evaluator.tick(at(605));
      expect(stateOf(t, DC, 100)).toBe('FAILED');
      t.check(DC, 100, false, at(900), { kind: 'REGULAR' });
      await t.evaluator.tick(at(905));
      expect(stateOf(t, DC, 100)).toBe('FAILED');
      expect(t.incidents()[0].recoveredAt).toBeNull();
    });

    it('no reconcilia mientras haya señales sin procesar de esa sonda y servicio', async () => {
      const t = setup();
      t.signal(OFFICE, 'VERIFYING', 101, T0);
      await t.evaluator.tick(at(1));
      t.check(OFFICE, 101, true, at(300), { kind: 'REGULAR' });
      t.check(OFFICE, 101, true, at(600), { kind: 'REGULAR' });
      // Señal retenida esperando su cruce: la clave (oficina, 101) sigue pendiente.
      const held = t.signal(OFFICE, 'CONFIRMED_FAILURE', 101, at(250), { awaitingCrossUntil: at(5000) });
      await t.evaluator.tick(at(601));
      expect(t.sig(held.id).processedAt).toBeNull();
      expect(stateOf(t, OFFICE, 101)).toBe('VERIFYING');
    });

    it('DEGRADED de la oficina: dos correctas rápidas lo cierran; las lentas no', async () => {
      const t = setup();
      t.signal(OFFICE, 'DEGRADED', 100, T0);
      await t.evaluator.tick(at(1));
      t.check(OFFICE, 100, true, at(300), { kind: 'REGULAR', durationMs: 4000 });
      t.check(OFFICE, 100, true, at(600), { kind: 'REGULAR', durationMs: 4000 });
      await t.evaluator.tick(at(605));
      expect(stateOf(t, OFFICE, 100)).toBe('DEGRADED');
      expect(t.incidents()[0].recoveredAt).toBeNull();
      t.check(OFFICE, 100, true, at(900), { kind: 'REGULAR', durationMs: 50 });
      t.check(OFFICE, 100, true, at(1200), { kind: 'REGULAR', durationMs: 50 });
      await t.evaluator.tick(at(1205));
      expect(stateOf(t, OFFICE, 100)).toBe('OK');
      expect(t.incidents()[0]).toMatchObject({ kind: 'DEGRADED', recoveredAt: at(1200) });
    });

    it('VERIFYING colgado (la sonda reinició antes de los reintentos): dos correctas después lo devuelven a OK', async () => {
      const t = setup();
      t.signal(OFFICE, 'VERIFYING', 101, T0);
      await t.evaluator.tick(at(1));
      t.check(OFFICE, 101, true, at(300), { kind: 'REGULAR' });
      t.check(OFFICE, 101, true, at(600), { kind: 'REGULAR' });
      await t.evaluator.tick(at(601));
      expect(stateOf(t, OFFICE, 101)).toBe('OK');
    });

    it('caída de oficina abierta sin END: se cierra cuando llegan comprobaciones mayoritariamente correctas posteriores a inicio + un intervalo', async () => {
      const t = setup();
      t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, T0);
      await t.evaluator.tick(at(1));
      // Dentro del primer intervalo (5 min de día): no cuentan.
      for (const id of [100, 101, 102]) t.check(OFFICE, id, true, at(100), { kind: 'REGULAR' });
      await t.evaluator.tick(at(110));
      expect(t.db.rows<MonitorOfficeOutage>(MonitorOfficeOutage)[0].endedAt).toBeNull();
      // Después: 2 de 3 correctas (fallan menos de ceil(3/2)).
      t.check(OFFICE, 100, true, at(400), { kind: 'REGULAR' });
      t.check(OFFICE, 101, true, at(410), { kind: 'REGULAR' });
      t.check(OFFICE, 102, false, at(420), { kind: 'REGULAR' });
      await t.evaluator.tick(at(430));
      expect(t.db.rows<MonitorOfficeOutage>(MonitorOfficeOutage)[0].endedAt).toEqual(at(420));
    });

    it('caída de oficina abierta con la mitad o más de las comprobaciones posteriores fallando: sigue abierta', async () => {
      const t = setup();
      t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, T0);
      await t.evaluator.tick(at(1));
      t.check(OFFICE, 100, true, at(400), { kind: 'REGULAR' });
      t.check(OFFICE, 101, false, at(410), { kind: 'REGULAR' });
      await t.evaluator.tick(at(430));
      expect(t.db.rows<MonitorOfficeOutage>(MonitorOfficeOutage)[0].endedAt).toBeNull();
    });

    it('fallo de la oficina durante su caída: el estado queda FAILED sin incidente y la reconciliación lo devuelve a OK', async () => {
      const t = setup();
      t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, T0);
      t.signal(OFFICE, 'CONFIRMED_FAILURE', 100, at(30));
      await t.evaluator.tick(at(40));
      expect(t.incidents()).toHaveLength(0);
      expect(stateOf(t, OFFICE, 100)).toBe('FAILED');
      t.check(OFFICE, 100, true, at(400), { kind: 'REGULAR' });
      t.check(OFFICE, 100, true, at(700), { kind: 'REGULAR' });
      await t.evaluator.tick(at(701));
      expect(stateOf(t, OFFICE, 100)).toBe('OK');
      expect(t.db.rows<MonitorOfficeOutage>(MonitorOfficeOutage)[0].endedAt).toEqual(at(700));
      expect(t.incidents()).toHaveLength(0);
    });

    it('DEGRADED: dos correctas rápidas MANUAL/CROSS no lo cierran; dos REGULAR sí', async () => {
      const t = setup();
      t.signal(OFFICE, 'DEGRADED', 100, T0);
      await t.evaluator.tick(at(1));
      t.check(OFFICE, 100, true, at(300), { kind: 'MANUAL', durationMs: 50 });
      t.check(OFFICE, 100, true, at(600), { kind: 'MANUAL', durationMs: 50 });
      await t.evaluator.tick(at(605));
      expect(stateOf(t, OFFICE, 100)).toBe('DEGRADED');
      expect(t.incidents()[0].recoveredAt).toBeNull();
      t.check(OFFICE, 100, true, at(900), { kind: 'REGULAR', durationMs: 50 });
      t.check(OFFICE, 100, true, at(1000), { kind: 'CROSS', durationMs: 50 });
      await t.evaluator.tick(at(1005));
      expect(stateOf(t, OFFICE, 100)).toBe('DEGRADED');
      t.check(OFFICE, 100, true, at(1200), { kind: 'REGULAR', durationMs: 50 });
      await t.evaluator.tick(at(1205));
      expect(stateOf(t, OFFICE, 100)).toBe('OK');
      expect(t.incidents()[0]).toMatchObject({ kind: 'DEGRADED', recoveredAt: at(1200) });
    });
  });

  describe('cerrar una caída de oficina reevalúa la recuperación', () => {
    const stateRow = (t: ReturnType<typeof setup>, probeId: number, serviceId: number) =>
      t.db.rows<MonitorProbeState>(MonitorProbeState).filter((r) => r.probeId === probeId && r.serviceId === serviceId).pop()!;
    const recoveredEvents = (t: ReturnType<typeof setup>) => t.events().filter((e) => e.type === 'RECOVERED');

    /** ROUTE abierto (oficina FAILED, servidor OK por el cruce) y caída de oficina abierta desde at(300). */
    const routeDuringOutage = async () => {
      const t = setup();
      await t.officeDownWithCross(100, T0, true);
      t.state(DC, 100, 'OK');
      expect(t.incidents()[0]).toMatchObject({ kind: 'ROUTE', recoveredAt: null });
      t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, at(300));
      await t.evaluator.tick(at(301));
      t.tickets.comment.mockClear();
      return t;
    };

    it('STATE_SYNC(OK) de la oficina procesado antes de OFFICE_OUTAGE_END: al cerrar la caída el ROUTE se cierra una vez, con un comentario', async () => {
      const t = await routeDuringOutage();
      // El runner entrega [...señales, ...pendientes de oficina]: la STATE_SYNC llega antes que el END.
      t.signal(OFFICE, 'STATE_SYNC', 100, at(400));
      t.signal(OFFICE, 'OFFICE_OUTAGE_END', null, at(500));
      await t.evaluator.tick(at(501));
      const inc = t.incidents()[0];
      expect(inc).toMatchObject({ kind: 'ROUTE', recoveredAt: at(500), closeReason: 'RECOVERED' });
      expect(recoveredEvents(t)).toHaveLength(1);
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
      await t.evaluator.tick(at(700));
      expect(recoveredEvents(t)).toHaveLength(1);
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
    });

    it('lo mismo cuando la caída la cierra la reconciliación sin END', async () => {
      const t = await routeDuringOutage();
      t.signal(OFFICE, 'STATE_SYNC', 100, at(400));
      await t.evaluator.tick(at(401));
      expect(t.incidents()[0].recoveredAt).toBeNull(); // la caída sigue abierta
      t.check(OFFICE, 100, true, at(650), { kind: 'REGULAR' });
      t.check(OFFICE, 101, true, at(660), { kind: 'REGULAR' });
      await t.evaluator.tick(at(670));
      expect(t.db.rows<MonitorOfficeOutage>(MonitorOfficeOutage)[0].endedAt).toEqual(at(660));
      expect(t.incidents()[0]).toMatchObject({ recoveredAt: at(660), closeReason: 'RECOVERED' });
      expect(recoveredEvents(t)).toHaveLength(1);
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
    });

    it('con la caída aún abierta el ROUTE sigue abierto aunque la oficina esté OK (tampoco lo cierra el barrido)', async () => {
      const t = await routeDuringOutage();
      t.signal(OFFICE, 'STATE_SYNC', 100, at(400));
      await t.evaluator.tick(at(401));
      await t.evaluator.tick(at(402));
      expect(t.incidents()[0].recoveredAt).toBeNull();
      expect(t.tickets.comment).not.toHaveBeenCalled();
    });

    it('DOWN con el servidor aún FAILED: cerrar la caída no lo cierra (ni el barrido)', async () => {
      const t = setup();
      await t.officeDownWithCross(100, T0, false);
      t.state(DC, 100, 'FAILED');
      t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, at(300));
      await t.evaluator.tick(at(301));
      t.signal(OFFICE, 'STATE_SYNC', 100, at(400));
      t.signal(OFFICE, 'OFFICE_OUTAGE_END', null, at(500));
      await t.evaluator.tick(at(501));
      await t.evaluator.tick(at(600));
      expect(t.incidents()[0]).toMatchObject({ kind: 'DOWN', recoveredAt: null });
      expect(recoveredEvents(t)).toHaveLength(0);
    });

    it('barrido: un ROUTE colgado con la oficina OK y sin caída abierta se cierra una vez', async () => {
      const t = setup();
      await t.officeDownWithCross(100, T0, true);
      t.tickets.comment.mockClear();
      // Estado que dejó un orden de señales desfavorable: la oficina ya está OK y nadie reevaluó.
      Object.assign(stateRow(t, OFFICE, 100), { state: 'OK', stateChangedAt: at(450) });
      t.db.add(MonitorOfficeOutage, { probeId: OFFICE, startedAt: at(300), endedAt: at(500), affectedServices: 3 });
      await t.evaluator.tick(at(600));
      expect(t.incidents()[0]).toMatchObject({ kind: 'ROUTE', recoveredAt: at(500), closeReason: 'RECOVERED' });
      expect(recoveredEvents(t)).toHaveLength(1);
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
      await t.evaluator.tick(at(700));
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
    });

    it('barrido: un DOWN colgado con las dos sondas OK se cierra; con el último resultado del servidor fallido, no', async () => {
      const t = setup();
      await t.officeDownWithCross(100, T0, false);
      t.tickets.comment.mockClear();
      Object.assign(stateRow(t, OFFICE, 100), { state: 'OK', stateChangedAt: at(400) });
      t.state(DC, 100, 'OK');
      Object.assign(stateRow(t, DC, 100), { stateChangedAt: at(450), lastOk: false });
      await t.evaluator.tick(at(600));
      expect(t.incidents()[0].recoveredAt).toBeNull();
      stateRow(t, DC, 100).lastOk = true;
      await t.evaluator.tick(at(610));
      expect(t.incidents()[0]).toMatchObject({ kind: 'DOWN', recoveredAt: at(450), closeReason: 'RECOVERED' });
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
    });

    it('barrido: no cierra mientras haya señales pendientes del servicio', async () => {
      const t = setup();
      await t.officeDownWithCross(100, T0, true);
      Object.assign(stateRow(t, OFFICE, 100), { state: 'OK', stateChangedAt: at(450) });
      // Una señal de la oficina que no se puede procesar (error transitorio) queda pendiente: el estado no es fiable.
      const getRepository = t.db.manager.getRepository;
      (t.db.manager as any).getRepository = (e: any) => {
        const repo = getRepository(e);
        if (e !== MonitorProbeState) return repo;
        return {
          ...repo,
          update: async (where: any, patch: any) => {
            if (patch.state === 'VERIFYING') throw new Error('Lock wait timeout exceeded');
            return repo.update(where, patch);
          },
        };
      };
      jest.spyOn((t.evaluator as any).logger, 'error').mockImplementation(() => undefined);
      const pending = t.signal(OFFICE, 'VERIFYING', 100, at(460));
      await t.evaluator.tick(at(600));
      expect(t.sig(pending.id).processedAt).toBeNull();
      expect(t.incidents()[0].recoveredAt).toBeNull();
    });

    it('al cerrar la caída, dos servicios de un mismo padre se cierran y solo el padre comenta', async () => {
      const t = setup();
      await t.officeDownWithCross(100, T0, true);
      await t.officeDownWithCross(101, at(30), true);
      const parent = t.incidents().find((i) => i.serviceId === null)!;
      expect(parent).toBeDefined();
      t.state(DC, 100, 'OK');
      t.state(DC, 101, 'OK');
      t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, at(300));
      await t.evaluator.tick(at(301));
      t.tickets.comment.mockClear();
      t.signal(OFFICE, 'STATE_SYNC', 100, at(400));
      t.signal(OFFICE, 'STATE_SYNC', 101, at(400));
      t.signal(OFFICE, 'OFFICE_OUTAGE_END', null, at(500));
      await t.evaluator.tick(at(501));
      expect(t.incidents().every((i) => i.recoveredAt !== null && i.closeReason === 'RECOVERED')).toBe(true);
      expect(recoveredEvents(t)).toHaveLength(3);
      expect(t.tickets.comment).toHaveBeenCalledTimes(1);
      expect(t.tickets.comment).toHaveBeenCalledWith(parent.ticketId, expect.stringContaining('Servidor recuperado'), expect.anything());
    });
  });

  it('una señal que falla siempre se descarta tras 5 intentos y libera su clave', async () => {
    const t = setup();
    const getRepository = t.db.manager.getRepository;
    (t.db.manager as any).getRepository = (e: any) => {
      const repo = getRepository(e);
      if (e !== MonitorProbeState) return repo;
      return {
        ...repo,
        update: async (where: any, patch: any) => {
          if (Number(where.serviceId) === 999) throw new Error('Cannot add or update a child row: a foreign key constraint fails');
          return repo.update(where, patch);
        },
      };
    };
    const bad = t.signal(OFFICE, 'VERIFYING', 999, T0);
    const next = t.signal(OFFICE, 'OFFICE_OUTAGE_START', null, at(1));
    const held = t.signal(OFFICE, 'TRANSIENT_FAILURE', 999, at(30));
    for (let i = 1; i <= 4; i++) {
      await t.evaluator.tick(at(40 + i));
      expect(t.sig(bad.id).processedAt).toBeNull();
      expect(t.sig(held.id).processedAt).toBeNull();
    }
    expect(t.sig(next.id).processedAt).not.toBeNull();
    await t.evaluator.tick(at(50));
    expect(t.sig(bad.id).processedAt).toEqual(at(50));
  });
});
