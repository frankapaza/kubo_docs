import { TicketsService } from './tickets.service';
import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';

/**
 * create() escribe el ticket, le asigna código y registra el evento CREATED
 * dentro de una única transacción (ver comentario en tickets.service.ts), por
 * eso el manager falso expone un stub por entidad -- igual que en
 * ticket-transitions.service.spec.ts -- en vez de un único mock compartido.
 */
const makeService = () => {
  const savedTickets: Partial<Ticket>[] = [];
  const savedEvents: Partial<TicketEvent>[] = [];
  let ticketState: Partial<Ticket> = {};

  const ticketRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<Ticket>) => data),
    save: jest.fn().mockImplementation((data: Partial<Ticket>) => {
      const saved = { id: 99, ...data };
      savedTickets.push(saved);
      ticketState = saved;
      return Promise.resolve(saved);
    }),
    update: jest.fn().mockImplementation((_id: number, patch: Partial<Ticket>) => {
      ticketState = { ...ticketState, ...patch };
      return Promise.resolve({ affected: 1 });
    }),
    findOneBy: jest.fn().mockImplementation(() => Promise.resolve(ticketState)),
  };

  const eventRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<TicketEvent>) => data),
    save: jest.fn().mockImplementation((data: Partial<TicketEvent>) => {
      const saved = { id: savedEvents.length + 1, ...data };
      savedEvents.push(saved);
      return Promise.resolve(saved);
    }),
  };

  const manager = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === Ticket) return ticketRepoStub;
      if (entity === TicketEvent) return eventRepoStub;
      throw new Error(`getRepository inesperado: ${String(entity)}`);
    }),
  };

  const repo = {
    runInTransaction: jest.fn().mockImplementation((work: (m: unknown) => Promise<unknown>) => work(manager)),
    savedTickets,
    savedEvents,
  };
  const events = { listByTicket: jest.fn() };
  const sla = {
    initForTicket: jest.fn().mockResolvedValue({
      slaPolicyId: null,
      slaResponseDueAt: null,
      slaResolutionDueAt: null,
    }),
  };
  const clients = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 1 }) };
  const projects = { findById: jest.fn().mockResolvedValue({ id: 1 }) };

  return {
    service: new TicketsService(repo as any, events as any, sla as any, clients as any, projects as any),
    repo,
    events,
    sla,
    clients,
    projects,
  };
};

describe('create con actor', () => {
  it('un ticket del equipo pone created_by y deja nulo el de cliente', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any);
    const saved = repo.savedTickets[0];
    expect(saved.createdBy).toBe(5);
    expect(saved.createdByClientUserId).toBeNull();
  });

  it('un ticket del portal pone el de cliente y deja nulo created_by', async () => {
    const { service, repo } = makeService();
    await service.create(
      { kind: 'CLIENT', clientUserId: 11 },
      { rawText: 'algo', clientId: 1 } as any,
    );
    const saved = repo.savedTickets[0];
    expect(saved.createdBy).toBeNull();
    expect(saved.createdByClientUserId).toBe(11);
  });

  /**
   * La invariante "todo ticket tiene exactamente un autor" la sostenia solo la
   * union de TypeScript: con los ternarios `kind === 'STAFF' ? ... : null`, un
   * tercer valor producia un ticket Y su evento CREATED con las dos columnas
   * de actor nulas -- un ticket sin autor, posible desde que la 013 hizo
   * created_by nullable. Falla cerrado y antes de abrir la transaccion.
   */
  it('un actor de tipo no contemplado no crea nada: falla cerrado', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create({ kind: 'ROBOT', userId: 1 } as any, { rawText: 'algo' } as any),
    ).rejects.toThrow();
    expect(repo.runInTransaction).not.toHaveBeenCalled();
    expect(repo.savedTickets).toHaveLength(0);
    expect(repo.savedEvents).toHaveLength(0);
  });

  it('el evento CREATED de un ticket del equipo lleva el actor en actor_user_id', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any);
    const ev = repo.savedEvents[0];
    expect(ev.actorUserId).toBe(5);
    expect(ev.actorClientUserId).toBeNull();
  });

  it('el evento CREATED lleva el actor que corresponda', async () => {
    const { service, repo } = makeService();
    await service.create(
      { kind: 'CLIENT', clientUserId: 11 },
      { rawText: 'algo', clientId: 1 } as any,
    );
    const ev = repo.savedEvents[0];
    expect(ev.actorUserId).toBeNull();
    expect(ev.actorClientUserId).toBe(11);
  });
});
