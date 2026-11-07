import { TicketsService } from './tickets.service';
import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';

/**
 * Archivar / desarchivar. Arnés propio y mínimo: el de `tickets.service.spec`
 * está pensado para el alta (código, mensaje, rollbacks) y aquí sobra.
 */
const makeService = (inicial: Partial<Ticket>) => {
  let ticket = { id: 9, status: 'CERRADO', archivedAt: null, archivedBy: null, ...inicial } as Ticket;
  const eventos: Partial<TicketEvent>[] = [];

  const ticketRepo = {
    update: jest.fn().mockImplementation((_id: number, patch: Partial<Ticket>) => {
      ticket = { ...ticket, ...patch };
      return Promise.resolve({ affected: 1 });
    }),
    findOneBy: jest.fn().mockImplementation(() => Promise.resolve(ticket)),
  };
  const eventRepo = {
    create: jest.fn().mockImplementation((d: Partial<TicketEvent>) => d),
    save: jest.fn().mockImplementation((d: Partial<TicketEvent>) => {
      eventos.push(d);
      return Promise.resolve(d);
    }),
  };
  const manager = {
    getRepository: (e: unknown) => (e === Ticket ? ticketRepo : eventRepo),
  };
  const repo = {
    findById: jest.fn().mockImplementation(() => Promise.resolve(ticket)),
    runInTransaction: jest.fn().mockImplementation((work: (m: unknown) => unknown) => work(manager)),
  };

  const service = new TicketsService(repo as any, {} as any, {} as any, {} as any, {} as any);
  return { service, eventos, repo, current: () => ticket };
};

describe('archivar tickets', () => {
  it('archiva en cualquier estado y deja el evento ARCHIVED con el estado que tenía', async () => {
    const { service, eventos, current } = makeService({ status: 'EN_ATENCION' });

    await service.archive(9, 5, '  duplicado  ');

    expect(current().archivedAt).toBeInstanceOf(Date);
    expect(current().archivedBy).toBe(5);
    expect(current().status).toBe('EN_ATENCION');
    expect(eventos).toEqual([
      expect.objectContaining({
        type: 'ARCHIVED',
        actorUserId: 5,
        reason: 'duplicado',
        payload: { status: 'EN_ATENCION' },
      }),
    ]);
  });

  it('archivar uno ya archivado no escribe nada', async () => {
    const { service, eventos, repo } = makeService({ archivedAt: new Date(), archivedBy: 1 });

    await service.archive(9, 5);

    expect(eventos).toHaveLength(0);
    expect(repo.runInTransaction).not.toHaveBeenCalled();
  });

  it('desarchivar limpia las columnas y deja UNARCHIVED', async () => {
    const { service, eventos, current } = makeService({ archivedAt: new Date(), archivedBy: 1 });

    await service.unarchive(9, 5);

    expect(current().archivedAt).toBeNull();
    expect(current().archivedBy).toBeNull();
    expect(eventos).toEqual([expect.objectContaining({ type: 'UNARCHIVED', actorUserId: 5 })]);
  });
});
