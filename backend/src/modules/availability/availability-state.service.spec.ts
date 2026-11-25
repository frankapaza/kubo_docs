import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AvailabilityStateController } from './availability-state.controller';
import { AvailabilityStateService } from './availability-state.service';

const num = (d: any) => (d instanceof Date ? d.getTime() : d);
const isNullish = (v: any) => v === null || v === undefined;

/** Evalúa un `where` de TypeORM (igualdad y los operadores que usa el servicio) sobre filas en memoria. */
const matches = (row: any, where: any): boolean =>
  Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    const val = row[k];
    if (v instanceof FindOperator) {
      const t = v.type as string;
      const x: any = v.value;
      if (t === 'isNull') return isNullish(val);
      if (t === 'in') return (x as any[]).map(Number).includes(Number(val));
      if (t === 'between') return num(val) >= num(x[0]) && num(val) <= num(x[1]);
      if (t === 'moreThanOrEqual') return num(val) >= num(x);
      if (t === 'lessThanOrEqual') return num(val) <= num(x);
      if (t === 'lessThan') return !isNullish(val) && num(val) < num(x);
      if (t === 'moreThan') return !isNullish(val) && num(val) > num(x);
      if (t === 'not') return !(x instanceof FindOperator && x.type === 'isNull' ? isNullish(val) : num(val) === num(x));
      throw new Error(`operador no soportado: ${t}`);
    }
    if (v instanceof Date) return val instanceof Date && val.getTime() === v.getTime();
    return val === v;
  });

const repoOf = (rows: any[], startId = 1000) => {
  let nextId = startId;
  return {
    rows,
    find: jest.fn(async (opts: any = {}) => {
      let out = rows.filter((r) => matches(r, opts.where));
      const ord = opts.order ? Object.entries(opts.order)[0] : null;
      if (ord) {
        const [f, dir] = ord as [string, string];
        out = [...out].sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === 'DESC' ? -1 : 1));
      }
      return opts.take ? out.slice(0, opts.take) : out;
    }),
    findOne: jest.fn(async (opts: any) => rows.find((r) => matches(r, opts.where)) ?? null),
    insert: jest.fn(async (d: any) => {
      const row = { id: nextId++, ...d };
      rows.push(row);
      return { identifiers: [{ id: row.id }] };
    }),
    update: jest.fn(async (where: any, patch: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    }),
  };
};

const T0 = new Date('2026-11-24T12:00:00.000Z');
const ago = (ms: number) => new Date(T0.getTime() - ms);

const make = () => {
  const now = T0;
  const servers = repoOf([
    { id: 10, clientId: 1, name: 'srv-a', host: 'a.test', status: 'ACTIVE' },
    { id: 11, clientId: 2, name: 'srv-b', host: 'b.test', status: 'ACTIVE' },
  ]);
  const services = repoOf([
    { id: 100, serverId: 10, name: 'web', criticality: 'HIGH', status: 'ACTIVE', lastManualCheckAt: null },
    { id: 101, serverId: 10, name: 'api', criticality: 'MEDIUM', status: 'ACTIVE', lastManualCheckAt: null },
    { id: 102, serverId: 11, name: 'db', criticality: 'LOW', status: 'ACTIVE', lastManualCheckAt: null },
    { id: 103, serverId: 11, name: 'ftp', criticality: 'LOW', status: 'ACTIVE', lastManualCheckAt: null },
    { id: 104, serverId: 10, name: 'old', criticality: 'LOW', status: 'PAUSED', lastManualCheckAt: null },
  ]);
  const probes = repoOf([
    { id: 1, code: 'oficina-01', kind: 'OFFICE' },
    { id: 2, code: 'kubo-01', kind: 'DATACENTER' },
  ]);
  const states = repoOf([
    // 100 OK, 101 DOWN (incidente), 102 DEGRADED, 103 sin datos
    { probeId: 1, serviceId: 100, state: 'OK', lastCheckAt: now, lastLatencyMs: 40 },
    { probeId: 2, serviceId: 100, state: 'OK', lastCheckAt: now, lastLatencyMs: 40 },
    { probeId: 1, serviceId: 101, state: 'OK', lastCheckAt: now, lastLatencyMs: 40 },
    { probeId: 2, serviceId: 101, state: 'OK', lastCheckAt: now, lastLatencyMs: 40 },
    { probeId: 1, serviceId: 102, state: 'DEGRADED', lastCheckAt: now, lastLatencyMs: 40 },
    { probeId: 2, serviceId: 102, state: 'OK', lastCheckAt: now, lastLatencyMs: 40 },
  ]);
  const incidents = repoOf([
    { id: 500, serviceId: 101, serverId: 10, parentId: null, kind: 'DOWN', firstFailureAt: ago(3600_000), confirmedAt: ago(3000_000), recoveredAt: null, closeReason: null, ticketId: 900, acknowledgedBy: null, acknowledgedAt: null },
    // incidente de servidor (padre) con dos hijos, ya cerrados
    { id: 510, serviceId: null, serverId: 11, parentId: null, kind: 'DOWN', firstFailureAt: ago(7200_000), confirmedAt: ago(7000_000), recoveredAt: ago(1800_000), closeReason: 'RECOVERED', ticketId: 901, acknowledgedBy: null, acknowledgedAt: null },
    { id: 511, serviceId: 102, serverId: 11, parentId: 510, kind: 'DOWN', firstFailureAt: ago(7200_000), confirmedAt: ago(7000_000), recoveredAt: ago(1800_000), closeReason: 'RECOVERED', ticketId: null, acknowledgedBy: null, acknowledgedAt: null },
    { id: 512, serviceId: 103, serverId: 11, parentId: 510, kind: 'DOWN', firstFailureAt: ago(7100_000), confirmedAt: ago(6900_000), recoveredAt: ago(1700_000), closeReason: 'RECOVERED', ticketId: null, acknowledgedBy: null, acknowledgedAt: null },
  ]);
  const events = repoOf([
    { id: 2, incidentId: 510, at: ago(7000_000), type: 'OPENED', detail: { kind: 'DOWN', diagnosis: 'Caída confirmada desde ambas sondas' }, authorUserId: null },
    { id: 1, incidentId: 510, at: ago(7200_000), type: 'DETECTED', detail: null, authorUserId: null },
    { id: 3, incidentId: 510, at: ago(1800_000), type: 'RECOVERED', detail: null, authorUserId: null },
    { id: 4, incidentId: 500, at: ago(3000_000), type: 'OPENED', detail: { kind: 'ROUTE', diagnosis: 'viejo' }, authorUserId: null },
  ]);
  const checkRows: any[] = [];
  for (let i = 0; i < 40; i++) {
    for (const probeId of [1, 2]) {
      checkRows.push({ probeId, id: `${probeId}-${i}`, serviceId: 102, kind: 'REGULAR', startedAt: ago(7200_000 - i * 60_000), durationMs: 10, ok: true, errorCode: null, httpStatus: null });
    }
  }
  const checks = repoOf(checkRows);
  const orders = repoOf([]);
  // Transacción de juguete: si el callback falla, se restauran las filas de servicios y órdenes.
  (services as any).manager = {
    getRepository: (e: any) => (e.name === 'MonitorService' ? services : orders),
    transaction: async (cb: any) => {
      const snap = [services.rows.map((r: any) => ({ ...r })), [...orders.rows]];
      try {
        return await cb((services as any).manager);
      } catch (err) {
        services.rows.splice(0, services.rows.length, ...(snap[0] as any[]));
        orders.rows.splice(0, orders.rows.length, ...(snap[1] as any[]));
        throw err;
      }
    },
  };
  const clients = { list: jest.fn(async () => [{ id: 1, razonSocial: 'Acme' }, { id: 2, razonSocial: 'Beta' }]) };
  const tickets = {
    findCodesByIds: jest.fn(async (ids: number[]) => new Map([...new Set(ids)].map((id) => [id, `TK-${id}`] as [number, string]))),
  };
  const maintenance = repoOf([]);
  const svc = new AvailabilityStateService(
    servers as any, services as any, probes as any, states as any, incidents as any, events as any, checks as any, orders as any,
    clients as any, tickets as any, maintenance as any, { listForIncidents: jest.fn(async () => new Map()) } as any,
  );
  jest.useFakeTimers().setSystemTime(now);
  return { svc, services, orders, incidents, events, tickets, maintenance };
};

afterEach(() => jest.useRealTimers());

describe('AvailabilityStateService.state', () => {
  it('ordena DOWN, ROUTE, VERIFYING, DEGRADED, NO_DATA, OK y luego por nombre', async () => {
    const { svc } = make();
    const rows = await svc.state({});
    expect(rows.map((r) => [r.status, r.serviceName])).toEqual([
      ['DOWN', 'api'],
      ['DEGRADED', 'db'],
      ['NO_DATA', 'ftp'],
      ['OK', 'web'],
    ]);
  });

  it('rellena ticketCode con el ticket del incidente (el del padre en un hijo)', async () => {
    const { svc, incidents } = make();
    // servicio 102 con un incidente hijo abierto cuyo padre (510) lleva el ticket
    incidents.rows.push({ id: 520, serviceId: 102, serverId: 11, parentId: 510, kind: 'DOWN', firstFailureAt: ago(1000), confirmedAt: ago(500), recoveredAt: null, ticketId: null });
    const rows = await svc.state({});
    expect(rows.find((r) => r.serviceName === 'api')!.ticketCode).toBe('TK-900');
    expect(rows.find((r) => r.serviceName === 'db')!.ticketCode).toBe('TK-901');
    expect(rows.find((r) => r.serviceName === 'web')!.ticketCode).toBeNull();
  });

  it('marca maintenance solo en los servicios cubiertos por una ventana activa', async () => {
    const { svc, maintenance } = make();
    maintenance.rows.push(
      // servidor 11 (db, ftp) en mantenimiento ahora; web con una ventana ya terminada
      { id: 1, serverId: 11, serviceId: null, startsAt: ago(60_000), endsAt: new Date(T0.getTime() + 60_000), reason: 'parche' },
      { id: 2, serverId: null, serviceId: 100, startsAt: ago(7200_000), endsAt: T0, reason: 'vieja' },
    );
    const rows = await svc.state({});
    expect(Object.fromEntries(rows.map((r) => [r.serviceName, r.maintenance]))).toEqual({ api: false, db: true, ftp: true, web: false });
  });

  it('el filtro por cliente no devuelve servicios de otro cliente', async () => {
    const { svc } = make();
    const rows = await svc.state({ clientId: 1 });
    expect(rows.map((r) => r.serviceName)).toEqual(['api', 'web']);
    expect(rows.every((r) => r.clientId === 1)).toBe(true);
  });

  it('filtra por estado y por servidor; un estado inválido es BAD_INPUT', async () => {
    const { svc } = make();
    expect((await svc.state({ status: 'OK' })).map((r) => r.serviceName)).toEqual(['web']);
    expect((await svc.state({ serverId: 11 })).map((r) => r.serviceName)).toEqual(['db', 'ftp']);
    await expect(svc.state({ status: 'XX' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('CSV: BOM, separador ; y nombre de cliente', async () => {
    const { svc } = make();
    const csv = await svc.stateCsv({ clientId: 1 });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toContain('"Cliente";"Servidor"');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Acme";"srv-a";"api"');
    expect(lines[1]).toContain('"TK-900"');
  });
});

describe('AvailabilityStateService.checkNow', () => {
  it('crea órdenes MANUAL para las dos sondas y marca last_manual_check_at', async () => {
    const { svc, orders, services } = make();
    await svc.checkNow(100);
    expect(orders.rows.map((o: any) => [o.probeId, o.serviceId, o.kind])).toEqual([[1, 100, 'MANUAL'], [2, 100, 'MANUAL']]);
    expect(services.rows[0].lastManualCheckAt).toEqual(T0);
  });

  it('dos veces en 10 s: la segunda es 429; pasados 15 s vuelve a valer', async () => {
    const { svc, orders } = make();
    await svc.checkNow(100);
    jest.setSystemTime(new Date(T0.getTime() + 10_000));
    await expect(svc.checkNow(100)).rejects.toMatchObject({ status: 429 });
    expect(orders.rows).toHaveLength(2);
    jest.setSystemTime(new Date(T0.getTime() + 16_000));
    await svc.checkNow(100);
    expect(orders.rows).toHaveLength(4);
  });

  it('si falla la inserción de una orden, el enfriamiento se deshace', async () => {
    const { svc, orders, services } = make();
    orders.insert.mockRejectedValueOnce(new Error('db'));
    await expect(svc.checkNow(100)).rejects.toThrow('db');
    expect(services.rows[0].lastManualCheckAt).toBeNull();
    await expect(svc.checkNow(100)).resolves.toMatchObject({ orders: 2 });
  });

  it('servicio inactivo -> 400 BAD_INPUT; inexistente -> 404', async () => {
    const { svc } = make();
    await expect(svc.checkNow(104)).rejects.toMatchObject({ response: { code: 'BAD_INPUT', message: 'El servicio no está activo' } });
    await expect(svc.checkNow(999)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AvailabilityStateService incidentes', () => {
  it('lista con filtros open/cliente y trae childCount, ticketCode y duración', async () => {
    const { svc } = make();
    const open = (await svc.listIncidents({ open: true })).items;
    expect(open.map((i) => i.id)).toEqual([500]);
    const closed = (await svc.listIncidents({ open: false, clientId: 2 })).items;
    expect(closed.map((i) => i.id).sort()).toEqual([510, 511, 512]);
    const parent = closed.find((i) => i.id === 510)!;
    expect(parent).toMatchObject({ kind: 'DOWN', serviceName: null, serverName: 'srv-b', clientName: 'Beta', childCount: 2, ticketCode: 'TK-901', durationMinutes: 90 });
    expect(closed.find((i) => i.id === 511)!.ticketCode).toBe('TK-901');
    expect(parent.parentId).toBeNull();
    expect(closed.find((i) => i.id === 511)).toMatchObject({ parentId: 510, serverId: parent.serverId });
    expect(typeof parent.serverId).toBe('number');
    const none = await svc.listIncidents({ clientId: 1, from: new Date(T0.getTime() + 1000) });
    expect(none).toEqual({ items: [], truncated: false });
  });

  it('limit acota la lista, devuelve los más recientes y marca truncated', async () => {
    const { svc } = make();
    const r = await svc.listIncidents({ limit: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.items[0].id).toBe(500);
    const all = await svc.listIncidents({ limit: 4 });
    expect(all.truncated).toBe(false);
    expect((await svc.listIncidents({ limit: 99999 })).items).toHaveLength(4);
  });

  it('los códigos de ticket se piden en una sola consulta', async () => {
    const { svc, tickets } = make();
    await svc.listIncidents({});
    expect(tickets.findCodesByIds).toHaveBeenCalledTimes(1);
    await svc.state({});
    expect(tickets.findCodesByIds).toHaveBeenCalledTimes(2);
  });

  it('detalle: hijos, eventos cronológicos, diagnóstico guardado, host y últimas 30 comprobaciones por sonda', async () => {
    const { svc } = make();
    const d = await svc.incidentDetail(510);
    expect(d.children.map((c) => c.id)).toEqual([511, 512]);
    expect(d.events.map((e) => e.type)).toEqual(['DETECTED', 'OPENED', 'RECOVERED']);
    expect(d.diagnosis).toBe('Caída confirmada desde ambas sondas');
    expect(d.winmtrTarget).toBe('b.test');
    expect(d.checks.office).toHaveLength(30);
    expect(d.checks.datacenter).toHaveLength(30);
    const t = d.checks.office.map((c) => new Date(c.startedAt).getTime());
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(d.incident).toMatchObject({ id: 510, ticketCode: 'TK-901' });
  });

  it('detalle: un diagnóstico de otro tipo no vale y se usa el texto del tipo; 404 si no existe', async () => {
    const { svc } = make();
    const d = await svc.incidentDetail(500);
    expect(d.diagnosis).not.toBe('viejo');
    await expect(svc.incidentDetail(999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ack dos veces no duplica el evento y devuelve lo mismo', async () => {
    const { svc, events } = make();
    const a = await svc.acknowledge(500, 7);
    jest.setSystemTime(new Date(T0.getTime() + 5000));
    const b = await svc.acknowledge(500, 8);
    expect(events.rows.filter((e: any) => e.type === 'ACKNOWLEDGED' && e.incidentId === 500)).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ incidentId: 500, acknowledgedBy: 7 });
    expect(events.rows.find((e: any) => e.type === 'ACKNOWLEDGED').authorUserId).toBe(7);
  });

  it('notas: recorta, guarda author_user_id y rechaza vacías o de más de 2000', async () => {
    const { svc, events } = make();
    await svc.addNote(500, '  llamé al cliente  ', 7);
    expect(events.rows.find((e: any) => e.type === 'NOTE')).toMatchObject({ incidentId: 500, authorUserId: 7, detail: { text: 'llamé al cliente' } });
    await expect(svc.addNote(500, '   ', 7)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addNote(500, 'x'.repeat(2001), 7)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addNote(999, 'hola', 7)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AvailabilityStateController roles', () => {
  const proto = AvailabilityStateController.prototype as any;
  it.each(['state', 'stateCsv', 'checkNow', 'listIncidents', 'incidentDetail', 'acknowledge', 'addNote'])('%s queda abierto al personal', (h) => {
    expect(Reflect.getMetadata(ROLES_KEY, proto[h])).toBeUndefined();
  });
});
