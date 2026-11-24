import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AvailabilityEvaluatorService } from './availability-evaluator.service';
import { DIAGNOSIS_LABELS } from './domain/diagnose';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorIncidentEvent } from './entities/monitor-incident-event.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
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
/* las claves únicas de incidentes abiertos de la migración 031 y rollback   */
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
    db.add(MonitorService, { id, serverId, systemId, name, protocol: 'TCP', criticality, status: 'ACTIVE' });
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
    await t.evaluator.tick(at(130));
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

  it('ensureTicket con 5xx se reintenta en el siguiente tick', async () => {
    const t = setup();
    t.tickets.ensureTicket.mockRejectedValueOnce(new ServiceUnavailableException('caído'));
    await t.officeDownWithCross(100, T0, false);
    expect(t.incidents()[0].ticketId).toBeNull();
    await t.evaluator.tick(at(60));
    expect(t.incidents()[0].ticketId).toBe(901);
    expect(t.events().some((e) => e.type === 'TICKET_NOT_CREATED')).toBe(false);
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
});
