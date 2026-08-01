import { WorkItemsService } from './work-items.service';
import { WorkItem } from './entities/work-item.entity';

const column = (priorities: string[]): WorkItem[] =>
  priorities.map((p, i) => ({ id: i + 1, priority: p, boardOrder: i }) as WorkItem);

const makeService = (pendingColumn: WorkItem[] = []) => {
  const created = { id: 99, status: 'PENDIENTE', priority: 'MEDIA' } as WorkItem;
  const applied: number[][] = [];
  const repo = {
    listColumn: jest.fn().mockResolvedValue(pendingColumn),
    applyOrder: jest.fn().mockImplementation((_m, ids: number[]) => {
      applied.push(ids);
      return Promise.resolve();
    }),
    findById: jest.fn().mockResolvedValue(created),
    runInTransaction: jest.fn().mockImplementation((work) =>
      work({ getRepository: () => ({
        save: jest.fn().mockImplementation((e) => Promise.resolve({ ...created, ...e })),
        create: jest.fn().mockImplementation((e) => e),
        update: jest.fn().mockResolvedValue(undefined),
      }) }),
    ),
  };
  const events = { record: jest.fn().mockResolvedValue({}), listByItem: jest.fn() };
  const clients = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 1 }) };
  const projects = { findById: jest.fn().mockResolvedValue({ id: 1 }) };
  return {
    service: new WorkItemsService(repo as any, events as any, clients as any, projects as any),
    repo, events, clients, projects, applied,
  };
};

describe('create', () => {
  it('valida el cliente', async () => {
    const { service, clients } = makeService();
    await service.create(5, { clientId: 1, title: 'Ajustar IGV' });
    expect(clients.findByIdOrFail).toHaveBeenCalledWith(1);
  });

  it('valida el proyecto solo si viene', async () => {
    const { service, projects } = makeService();
    await service.create(5, { clientId: 1, title: 'X' });
    expect(projects.findById).not.toHaveBeenCalled();

    const b = makeService();
    await b.service.create(5, { clientId: 1, projectId: 7, title: 'X' });
    expect(b.projects.findById).toHaveBeenCalledWith(7);
  });

  it('usa MEDIA cuando no se indica prioridad', async () => {
    const { service, repo } = makeService();
    await service.create(5, { clientId: 1, title: 'X' });
    const saved = repo.runInTransaction.mock.calls.length;
    expect(saved).toBe(1);
  });

  it('coloca un ALTA nuevo sobre los MEDIA, renumerando la columna', async () => {
    // columna: ids 1(ALTA) 2(MEDIA) 3(BAJA) -> el nuevo (99) va al indice 1
    const { service, applied } = makeService(column(['ALTA', 'MEDIA', 'BAJA']));
    await service.create(5, { clientId: 1, title: 'Urgente', priority: 'ALTA' });
    expect(applied[0]).toEqual([1, 99, 2, 3]);
  });

  it('coloca un BAJA nuevo al fondo', async () => {
    const { service, applied } = makeService(column(['ALTA', 'MEDIA']));
    await service.create(5, { clientId: 1, title: 'Cosmetico', priority: 'BAJA' });
    expect(applied[0]).toEqual([1, 2, 99]);
  });

  it('registra exactamente un evento CREATED', async () => {
    const { service, events } = makeService();
    await service.create(5, { clientId: 1, title: 'X' });
    expect(events.record).toHaveBeenCalledTimes(1);
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CREATED', toStatus: 'PENDIENTE', actorUserId: 5 }),
    );
  });
});
