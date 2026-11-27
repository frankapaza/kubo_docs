import { FindOperator } from 'typeorm';
import { AvailabilityAgentService } from './availability-agent.service';
import { latestAgentDisks } from './domain/agent-disks-repo';

const NOW = new Date('2026-11-24T15:00:00.000Z');
const GB = 1024 ** 3;
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

const matches = (row: any, where: any) =>
  Object.entries(where).every(([k, v]) => {
    if (v instanceof FindOperator) {
      if (v.type === 'moreThanOrEqual') return row[k].getTime() >= (v.value as Date).getTime();
      throw new Error(`operador no soportado: ${v.type}`);
    }
    return row[k] === v;
  });

const make = (rows: any[], servers: any[] = [{ id: 10, name: 'srv', agentVersion: '0.9.0', agentWatchServices: null }]) => {
  const samples = {
    rows,
    insert: jest.fn(async (r: any) => rows.push(r)),
    find: jest.fn(async ({ where, order }: any) => {
      const out = rows.filter((r) => matches(r, where));
      return order?.at === 'ASC' ? out.sort((a, b) => a.at - b.at) : out;
    }),
    findOne: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where)).sort((a, b) => b.at - a.at)[0] ?? null),
  };
  const serverRepo = {
    findOne: jest.fn(async ({ where }: any) => servers.find((s) => s.id === where.id) ?? null),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  return { svc: new AvailabilityAgentService(serverRepo as any, samples as any), samples, serverRepo };
};

const sampleAt = (h: number, freeC: number, over: any = {}) => ({
  serverId: 10,
  at: hoursAgo(h),
  cpuPct: 10 + h,
  ramPct: 50,
  disks: [
    { name: 'C:', totalBytes: 200 * GB, freeBytes: freeC },
    { name: 'D:', totalBytes: 0, freeBytes: 0 },
  ],
  iis: { pools: [{ name: 'DefaultAppPool', state: 'Started' }] },
  services: [{ name: 'W3SVC', status: 'Running' }],
  eventErrors: 2,
  agentVersion: '1.0.0',
  ...over,
});

describe('AvailabilityAgentService', () => {
  it('acceptSample guarda con la hora de recepción, suma los errores y marca el servidor', async () => {
    const { svc, samples, serverRepo } = make([]);
    const res = await svc.acceptSample(
      { id: 10, agentWatchServices: ['W3SVC', 'MSSQLSERVER'] } as any,
      {
        agentVersion: '1.0.1', cpuPct: 1, ramPct: 2, disks: [], iisPools: null, services: [],
        eventErrors: { system: 4, application: 5 },
      } as any,
      NOW,
    );
    expect(res).toEqual({ watchServices: ['W3SVC', 'MSSQLSERVER'], intervalSeconds: 60 });
    expect(samples.rows[0]).toMatchObject({ serverId: 10, at: NOW, eventErrors: 9, iis: { pools: null }, agentVersion: '1.0.1' });
    expect(serverRepo.update).toHaveBeenCalledWith(10, { agentLastSeenAt: NOW, agentVersion: '1.0.1' });
  });

  it('agentView: última muestra, discos con % libre y días para llenarse, series y errores de 24 h', async () => {
    // C: baja 1 GB por día desde hace 6 días hasta 100 GB ahora; una muestra de hace 30 h sale de las 24 h.
    const rows = [6, 5, 4, 3, 2, 1].map((d) => sampleAt(d * 24, (100 + d) * GB));
    rows.push(sampleAt(1, 100 * GB + 1 * GB / 24), sampleAt(0, 100 * GB));
    const { svc } = make(rows);
    const v = await svc.agentView(10, NOW);
    expect(v.lastSampleAt).toEqual(NOW);
    expect(v.agentVersion).toBe('1.0.0');
    expect(v.cpuPct).toBe(10);
    expect(v.disks[0]).toMatchObject({ name: 'C:', totalBytes: 200 * GB, freeBytes: 100 * GB, freePct: 50 });
    expect(v.disks[0].daysToFull).toBeCloseTo(100, 0);
    expect(v.disks[1]).toMatchObject({ name: 'D:', freePct: null, daysToFull: null });
    expect(v.iisPools).toEqual([{ name: 'DefaultAppPool', state: 'Started' }]);
    expect(v.services).toEqual([{ name: 'W3SVC', status: 'Running' }]);
    // 24 h: las de hace 24 h (límite inclusivo), 1 h y 0 h.
    expect(v.series24h.map((p) => p.at)).toEqual([hoursAgo(24), hoursAgo(1), NOW]);
    expect(v.eventErrors24h).toBe(6);
  });

  it('agentView sin muestras: vacío con la versión del servidor', async () => {
    const { svc } = make([]);
    await expect(svc.agentView(10, NOW)).resolves.toEqual({
      lastSampleAt: null, agentVersion: '0.9.0', cpuPct: null, ramPct: null, disks: [], iisPools: null,
      services: [], eventErrors24h: 0, series24h: [],
    });
  });

  it('agentView de un servidor que no existe -> 404', async () => {
    const { svc } = make([]);
    await expect(svc.agentView(99, NOW)).rejects.toMatchObject({ status: 404 });
  });

  it('latestAgentDisks devuelve los discos de la última muestra por servidor', async () => {
    const { samples } = make([sampleAt(2, 5 * GB), sampleAt(0, 7 * GB)]);
    const m = await latestAgentDisks(samples as any, [10, 11]);
    expect(m.get(10)![0].freeBytes).toBe(7 * GB);
    expect(m.has(11)).toBe(false);
  });
});
