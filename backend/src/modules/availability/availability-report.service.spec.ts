import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AvailabilityReportService, limaMonthOf } from './availability-report.service';

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
      case 'lessThan': return v !== null && v !== undefined && lt(v, op.value);
      case 'moreThan': return v !== null && v !== undefined && gt(v, op.value);
      case 'between': return v !== null && !lt(v, (op.value as any[])[0]) && !gt(v, (op.value as any[])[1]);
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
  async find(opts: any = {}) {
    let out = this.rows.filter((r) => matches(r, opts.where));
    for (const [k, dir] of Object.entries(opts.order ?? {}).reverse()) {
      out = [...out].sort((a, b) => (dir === 'DESC' ? -1 : 1) * (lt(a[k], b[k]) ? -1 : gt(a[k], b[k]) ? 1 : 0));
    }
    return out.map((r) => ({ ...r }));
  }
  async findOne(opts: any = {}) {
    return (await this.find(opts))[0] ?? null;
  }
  async upsert(values: Row, conflict: string[]) {
    const i = this.rows.findIndex((r) => conflict.every((k) => r[k] === values[k]));
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...values };
    else this.rows.push({ ...values, id: this.seq++ });
    return {};
  }
}

function build() {
  const repos = {
    reports: new FakeRepo(),
    servers: new FakeRepo(),
    services: new FakeRepo(),
    probes: new FakeRepo(),
    incidents: new FakeRepo(),
    events: new FakeRepo(),
    maintenance: new FakeRepo(),
    rollupRows: new FakeRepo(),
    gaps: new FakeRepo(),
    agentRollups: new FakeRepo(),
  };
  const rollups = { ensureRange: jest.fn().mockResolvedValue(undefined) };
  const evidence = { listForIncidents: jest.fn().mockResolvedValue(new Map()) };
  const clients = {
    findByIdOrFail: jest.fn(async (id: number) => {
      if (id !== 1 && id !== 2) throw new NotFoundException({ code: 'NOT_FOUND' });
      return { id, razonSocial: `Cliente ${id}` };
    }),
  };
  const clientSystems = { listByClient: jest.fn().mockResolvedValue([{ id: 5, name: 'ERP' }]) };
  const tickets = { findCodesByIds: jest.fn().mockResolvedValue(new Map()) };
  const svc = new AvailabilityReportService(
    repos.reports as any,
    repos.servers as any,
    repos.services as any,
    repos.probes as any,
    repos.incidents as any,
    repos.events as any,
    repos.maintenance as any,
    repos.rollupRows as any,
    repos.gaps as any,
    repos.agentRollups as any,
    rollups as any,
    evidence as any,
    clients as any,
    clientSystems as any,
    tickets as any,
  );
  repos.servers.rows.push({ id: 10, clientId: 1, name: 'SRV-A', status: 'ACTIVE' }, { id: 20, clientId: 2, name: 'SRV-B', status: 'ACTIVE' });
  repos.services.rows.push(
    { id: 100, serverId: 10, name: 'Web', systemId: 5, criticality: 'HIGH', status: 'ACTIVE', createdAt: new Date('2026-01-01T00:00:00Z') },
    { id: 200, serverId: 20, name: 'Web B', systemId: null, criticality: 'LOW', status: 'ACTIVE', createdAt: new Date('2026-01-01T00:00:00Z') },
  );
  repos.probes.rows.push({ id: 1, code: 'oficina-01', kind: 'OFFICE' }, { id: 2, code: 'kubo-01', kind: 'DATACENTER' });
  return { svc, repos, rollups };
}

describe('AvailabilityReportService', () => {
  it('limaMonthOf: el mes de Lima, no el de UTC', () => {
    expect(limaMonthOf(new Date('2026-11-01T04:59:00Z'))).toBe('2026-10');
    expect(limaMonthOf(new Date('2026-11-01T05:00:00Z'), -1)).toBe('2026-10');
    expect(limaMonthOf(new Date('2026-01-15T12:00:00Z'), -1)).toBe('2025-12');
  });

  it('generate: arma el informe, pide los resúmenes del mes y guarda la fila', async () => {
    const { svc, repos, rollups } = build();
    const start = new Date('2026-10-10T15:00:00Z');
    repos.incidents.rows.push({
      id: 1, serviceId: 100, serverId: 10, parentId: null, kind: 'DOWN', firstFailureAt: start,
      recoveredAt: new Date(start.getTime() + 60 * 60_000), ticketId: null,
    });
    const data = await svc.generate(1, '2026-10', new Date('2026-11-01T13:00:00Z'), 7);
    expect(rollups.ensureRange).toHaveBeenCalledWith('2026-10-01', '2026-10-31', expect.any(Date));
    expect(data.partial).toBe(false);
    expect(data.services.map((s) => s.serviceName)).toEqual(['Web']);
    expect(data.services[0].systemName).toBe('ERP');
    expect(data.services[0].downMinutes).toBe(60);
    expect(data.totals.incidents).toBe(1);
    expect(repos.reports.rows).toHaveLength(1);
    expect(repos.reports.rows[0]).toMatchObject({ clientId: 1, month: '2026-10', partial: false, generatedBy: 7 });
  });

  it('el mes en curso sale parcial con to = now', async () => {
    const { svc } = build();
    const now = new Date('2026-11-24T15:00:00Z');
    const data = await svc.generate(1, '2026-11', now, null);
    expect(data.partial).toBe(true);
    expect(data.to).toBe(now.toISOString());
  });

  it('dos generate del mismo (cliente, mes) dejan una sola fila', async () => {
    const { svc, repos } = build();
    await svc.generate(1, '2026-10', new Date('2026-11-01T13:00:00Z'), null);
    await svc.generate(1, '2026-10', new Date('2026-11-02T13:00:00Z'), 3);
    expect(repos.reports.rows).toHaveLength(1);
    expect(repos.reports.rows[0].generatedBy).toBe(3);
    expect(repos.reports.rows[0].generatedAt).toEqual(new Date('2026-11-02T13:00:00Z'));
  });

  it('un mes futuro da 400 MES_FUTURO', async () => {
    const { svc, repos } = build();
    const p = svc.generate(1, '2026-12', new Date('2026-11-24T15:00:00Z'), null);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.generate(1, '2026-12', new Date('2026-11-24T15:00:00Z'), null)).rejects.toMatchObject({
      response: { code: 'MES_FUTURO' },
    });
    expect(repos.reports.rows).toHaveLength(0);
  });

  it('un mes mal formado da 400 BAD_INPUT y un cliente inexistente 404', async () => {
    const { svc } = build();
    await expect(svc.generate(1, '2026-13', new Date(), null)).rejects.toMatchObject({ response: { code: 'BAD_INPUT' } });
    await expect(svc.generate(99, '2026-10', new Date('2026-11-24T15:00:00Z'), null)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('catchUp con un informe ya existente no regenera; genera solo el que falta', async () => {
    const { svc, repos } = build();
    repos.reports.rows.push({ id: 50, clientId: 1, month: '2026-10', partial: false, generatedAt: new Date(), generatedBy: null, data: {} });
    const gen = jest.spyOn(svc, 'generate');
    await svc.catchUp(new Date('2026-11-02T15:00:00Z'));
    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen).toHaveBeenCalledWith(2, '2026-10', expect.any(Date), null);
    expect(repos.reports.rows.find((r) => r.clientId === 1)!.id).toBe(50);
  });

  it('catchUp el día 1 a las 07:59 de Lima no genera; a las 08:00 sí', async () => {
    const { svc } = build();
    const gen = jest.spyOn(svc, 'generate');
    await svc.catchUp(new Date('2026-11-01T12:59:00Z'));
    expect(gen).not.toHaveBeenCalled();
    await svc.catchUp(new Date('2026-11-01T13:00:00Z'));
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it('monthly: el mes anterior para cada cliente con servicios no archivados o incidentes en el mes', async () => {
    const { svc, repos } = build();
    repos.services.rows.find((s) => s.id === 200)!.status = 'ARCHIVED';
    const gen = jest.spyOn(svc, 'generate').mockResolvedValue({} as any);
    jest.useFakeTimers({ now: new Date('2026-11-01T13:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    try {
      await svc.monthly();
    } finally {
      jest.useRealTimers();
    }
    expect(gen.mock.calls.map((c) => [c[0], c[1]])).toEqual([[1, '2026-10']]);
  });

  it('una sola pasada a la vez', async () => {
    const { svc } = build();
    let release!: () => void;
    const gen = jest.spyOn(svc, 'generate').mockImplementation(() => new Promise((r) => (release = () => r({} as any))));
    const first = svc.catchUp(new Date('2026-11-02T15:00:00Z'));
    await new Promise((r) => setImmediate(r));
    await svc.catchUp(new Date('2026-11-02T15:00:00Z'));
    expect(gen).toHaveBeenCalledTimes(1);
    release();
    await new Promise((r) => setImmediate(r));
    release();
    await first;
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it('get de un informe inexistente da 404; list devuelve mes, parcial y fecha', async () => {
    const { svc } = build();
    await expect(svc.get(1, '2026-10')).rejects.toBeInstanceOf(NotFoundException);
    await svc.generate(1, '2026-10', new Date('2026-11-01T13:00:00Z'), null);
    expect(await svc.list(1)).toEqual([{ month: '2026-10', partial: false, generatedAt: new Date('2026-11-01T13:00:00Z') }]);
    expect((await svc.get(1, '2026-10')).month).toBe('2026-10');
  });
});
