import { TicketAssignmentService } from './ticket-assignment.service';
import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';

const ticketRow = (over: Partial<Ticket> = {}): Ticket =>
  ({ id: 1, status: 'NUEVO', priority: 'P3', priorityOverridden: 0, impact: null, urgency: null, ...over }) as Ticket;

/**
 * assign/escalate/overridePriority escriben su propio cambio (no el de
 * transitions.transition, que abre su propia transacción por separado) con
 * el EntityManager de una única transacción — mismo idioma que
 * TicketsService.create() y TicketTransitionsService.transition() (ver
 * comentario ahí). Estos dobles imitan esa forma: runInTransaction invoca el
 * callback con un manager falso cuyo getRepository devuelve un stub por
 * entidad, para poder seguir verificando las reglas reales (qué campos se
 * escriben, qué evento se registra) en vez de la plomería de la transacción.
 */
const makeService = (current: Ticket, agents: any[] = []) => {
  let ticketState = current;

  const ticketRepoStub = {
    update: jest.fn().mockImplementation((_id: number, patch: Partial<Ticket>) => {
      ticketState = { ...ticketState, ...patch };
      return Promise.resolve({ affected: 1 });
    }),
    findOneBy: jest.fn().mockImplementation(() => Promise.resolve(ticketState)),
  };

  const eventRepoStub = {
    create: jest.fn().mockImplementation((data: unknown) => data),
    save: jest.fn().mockImplementation((data: unknown) => Promise.resolve({ id: 99, ...(data as object) })),
  };

  const manager = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === Ticket) return ticketRepoStub;
      if (entity === TicketEvent) return eventRepoStub;
      throw new Error(`getRepository inesperado: ${String(entity)}`);
    }),
  };

  const repo = {
    findById: jest.fn().mockResolvedValue(current),
    update: jest.fn().mockImplementation((_id, patch) => Promise.resolve({ ...current, ...patch })),
    countOpenByAssignee: jest.fn().mockResolvedValue(new Map([[10, 5], [11, 1]])),
    runInTransaction: jest.fn().mockImplementation((work: (m: unknown) => Promise<unknown>) => work(manager)),
  };
  const transitions = { transition: jest.fn().mockResolvedValue(current) };
  const agentsRepo = { listActive: jest.fn().mockResolvedValue(agents) };
  return {
    service: new TicketAssignmentService(repo as any, transitions as any, agentsRepo as any),
    repo,
    transitions,
    ticketRepoStub,
    eventRepoStub,
  };
};

describe('assign', () => {
  it('asigna y transiciona a ASIGNADO desde NUEVO', async () => {
    const { service, ticketRepoStub, transitions } = makeService(ticketRow({ status: 'NUEVO' }));
    await service.assign({ ticketId: 1, actorUserId: 5, assigneeUserId: 10 });
    expect(ticketRepoStub.update).toHaveBeenCalledWith(1, expect.objectContaining({ assigneeUserId: 10 }));
    expect(transitions.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ASIGNADO' }),
    );
  });

  it('reasignar un ticket ya en atencion no cambia el estado', async () => {
    const { service, transitions } = makeService(ticketRow({ status: 'EN_ATENCION' }));
    await service.assign({ ticketId: 1, actorUserId: 5, assigneeUserId: 11 });
    expect(transitions.transition).not.toHaveBeenCalled();
  });
});

describe('take', () => {
  it('toma el ticket y transiciona a EN_ATENCION desde ASIGNADO', async () => {
    const { service, repo, transitions } = makeService(ticketRow({ status: 'ASIGNADO' }));
    await service.take({ ticketId: 1, actorUserId: 5 });
    expect(repo.update).toHaveBeenCalledWith(1, { assigneeUserId: 5 });
    expect(transitions.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'EN_ATENCION' }),
    );
  });

  it('rechaza tomar un ticket NUEVO y no escribe nada', async () => {
    const { service, repo, transitions } = makeService(ticketRow({ status: 'NUEVO' }));
    await expect(service.take({ ticketId: 1, actorUserId: 5 })).rejects.toThrow();
    expect(repo.update).not.toHaveBeenCalled();
    expect(transitions.transition).not.toHaveBeenCalled();
  });
});

describe('escalate', () => {
  it('registra nivel destino y motivo, y transiciona a DERIVADO', async () => {
    const { service, ticketRepoStub, transitions } = makeService(ticketRow({ status: 'EN_ATENCION' }));
    await service.escalate({
      ticketId: 1,
      actorUserId: 5,
      toLevel: 'N3',
      reason: 'Requiere infraestructura',
    });
    expect(ticketRepoStub.update).toHaveBeenCalledWith(1, expect.objectContaining({ escalationLevel: 'N3' }));
    expect(transitions.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'DERIVADO', reason: 'Requiere infraestructura' }),
    );
  });

  it('rechaza derivar un ticket RESUELTO y no escribe nada', async () => {
    const { service, ticketRepoStub, transitions } = makeService(ticketRow({ status: 'RESUELTO' }));
    await expect(
      service.escalate({ ticketId: 1, actorUserId: 5, toLevel: 'N3', reason: 'Motivo valido' }),
    ).rejects.toThrow();
    expect(ticketRepoStub.update).not.toHaveBeenCalled();
    expect(transitions.transition).not.toHaveBeenCalled();
  });
});

describe('overridePriority', () => {
  it('fijar prioridad a mano marca priority_overridden y registra el evento', async () => {
    const { service, ticketRepoStub, eventRepoStub } = makeService(ticketRow());
    await service.overridePriority({
      ticketId: 1,
      actorUserId: 5,
      priority: 'P1',
      reason: 'El cliente escalo por contrato',
    });
    const patch = ticketRepoStub.update.mock.calls[0][1];
    expect(patch.priority).toBe('P1');
    expect(patch.priorityOverridden).toBe(1);
    expect(eventRepoStub.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PRIORITY_OVERRIDDEN' }),
    );
  });

  it('cambiar impacto y urgencia recalcula sin marcar override', async () => {
    const { service, ticketRepoStub } = makeService(ticketRow());
    await service.overridePriority({
      ticketId: 1,
      actorUserId: 5,
      impact: 'ALTO',
      urgency: 'ALTA',
      reason: 'Afecta las 3 sedes',
    });
    const patch = ticketRepoStub.update.mock.calls[0][1];
    expect(patch.priority).toBe('P1');
    expect(patch.priorityOverridden).toBe(0);
  });
});

describe('suggestAssignee', () => {
  it('prefiere al agente con la especialidad y menor carga', async () => {
    const agents = [
      { id: 1, userId: 10, level: 'N2', specialties: ['SOPORTE'], isActive: 1 },
      { id: 2, userId: 11, level: 'N2', specialties: ['SOPORTE'], isActive: 1 },
      { id: 3, userId: 12, level: 'N1', specialties: ['CAPACITACION'], isActive: 1 },
    ];
    const { service } = makeService(ticketRow({ serviceCategory: 'SOPORTE' } as Partial<Ticket>), agents);
    const r = await service.suggestAssignee(1);
    // userId 11 tiene 1 ticket abierto frente a los 5 del userId 10
    expect(r?.userId).toBe(11);
  });

  it('devuelve null si ningun agente cubre la categoria', async () => {
    const agents = [{ id: 3, userId: 12, level: 'N1', specialties: ['CAPACITACION'], isActive: 1 }];
    const { service } = makeService(ticketRow({ serviceCategory: 'SOPORTE' } as Partial<Ticket>), agents);
    expect(await service.suggestAssignee(1)).toBeNull();
  });
});
