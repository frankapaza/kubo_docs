import { SlaRiskScheduler } from './sla-risk.scheduler';
import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';

/**
 * El escaneo de riesgo cambia tickets sin que nadie del equipo actúe: las
 * bandejas abiertas tienen que enterarse para pintar la bandera.
 */
describe('SlaRiskScheduler: aviso en vivo', () => {
  const make = (
    candidates: Partial<Ticket>[],
    opts: { enRiesgo?: (t: Partial<Ticket>) => boolean; fallaEn?: number; realtime?: any } = {},
  ) => {
    let llamadas = 0;
    const manager = {
      getRepository: (entity: unknown) =>
        entity === Ticket
          ? { update: jest.fn().mockResolvedValue({ affected: 1 }) }
          : entity === TicketEvent
            ? { create: (d: unknown) => d, save: jest.fn().mockResolvedValue({}) }
            : null,
    };
    const repo = {
      listOpenForRiskScan: jest.fn().mockResolvedValue(candidates),
      runInTransaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) => {
        llamadas += 1;
        if (opts.fallaEn === llamadas) throw new Error('fallo en la transacción');
        return work(manager);
      }),
    };
    const sla = { evaluateRisk: jest.fn((t: Partial<Ticket>) => (opts.enRiesgo ?? (() => true))(t)) };
    const scheduler = new SlaRiskScheduler(repo as any, {} as any, sla as any, opts.realtime);
    return { scheduler, repo };
  };

  it('avisa una vez por pasada cuando marca tickets, después de confirmarlos', async () => {
    const realtime = { notifyChanged: jest.fn() };
    const { scheduler, repo } = make([{ id: 1 }, { id: 2 }], { realtime });

    await expect(scheduler.scan()).resolves.toBe(2);

    expect(realtime.notifyChanged).toHaveBeenCalledTimes(1);
    expect(realtime.notifyChanged.mock.invocationCallOrder[0]).toBeGreaterThan(
      repo.runInTransaction.mock.invocationCallOrder[1],
    );
  });

  it('no avisa si no marcó nada', async () => {
    const realtime = { notifyChanged: jest.fn() };
    const { scheduler } = make([{ id: 1 }], { realtime, enRiesgo: () => false });

    await expect(scheduler.scan()).resolves.toBe(0);
    expect(realtime.notifyChanged).not.toHaveBeenCalled();
  });

  it('si falla a mitad, avisa igual por los ya marcados y propaga el error', async () => {
    const realtime = { notifyChanged: jest.fn() };
    const { scheduler } = make([{ id: 1 }, { id: 2 }], { realtime, fallaEn: 2 });

    await expect(scheduler.scan()).rejects.toThrow('fallo en la transacción');
    expect(realtime.notifyChanged).toHaveBeenCalledTimes(1);
  });

  it('un aviso que revienta no tumba el escaneo', async () => {
    const realtime = {
      notifyChanged: jest.fn(() => {
        throw new Error('socket caído');
      }),
    };
    const { scheduler } = make([{ id: 1 }], { realtime });
    await expect(scheduler.scan()).resolves.toBe(1);
  });

  it('sin gateway marca igual', async () => {
    const { scheduler } = make([{ id: 1 }]);
    await expect(scheduler.scan()).resolves.toBe(1);
  });
});
