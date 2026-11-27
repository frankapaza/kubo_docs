import { FindOperator } from 'typeorm';
import { AvailabilitySyncService } from './availability-sync.service';

const row = (serviceId: number, incidentId: number | null) => ({ serviceId, incidentId, ticketCode: null as string | null });

const makeSvc = (incidents: any[], ticketCodes: Record<number, string>, state: any[]) => {
  const repo = {
    find: jest.fn(async (opts: any) => {
      const w = opts.where.id as FindOperator<number[]>;
      return incidents.filter((i) => (w.value as number[]).includes(i.id));
    }),
  };
  const tickets = {
    findCodesByIds: jest.fn(async (ids: number[]) => new Map(ids.filter((i) => ticketCodes[i]).map((i) => [i, ticketCodes[i]]))),
  };
  const ingest = { sync: jest.fn(async () => ({ configVersion: 'v', config: null, orders: [], state })) };
  return { svc: new AvailabilitySyncService(ingest as any, repo as any, tickets as any), tickets, ingest };
};

describe('AvailabilitySyncService', () => {
  it('ticketCode: el del incidente, el del padre para un hijo, null sin incidente; una sola consulta de códigos', async () => {
    const { svc, tickets } = makeSvc(
      [
        { id: 40, parentId: null, ticketId: 7 },
        { id: 50, parentId: 40, ticketId: null },
        { id: 51, parentId: null, ticketId: 7 },
      ],
      { 7: 'KB-0007' },
      [row(100, 50), row(101, 51), row(102, null)],
    );
    const res = await svc.sync({} as any, null);
    expect(res.state.map((r: any) => r.ticketCode)).toEqual(['KB-0007', 'KB-0007', null]);
    expect(tickets.findCodesByIds).toHaveBeenCalledTimes(1);
  });

  it('sin incidentes abiertos no consulta tickets', async () => {
    const { svc, tickets } = makeSvc([], {}, [row(100, null)]);
    await svc.sync({} as any, null);
    expect(tickets.findCodesByIds).not.toHaveBeenCalled();
  });
});
