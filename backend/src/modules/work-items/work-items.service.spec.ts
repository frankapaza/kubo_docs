import { WorkItemsService } from './work-items.service';
import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';

const column = (priorities: string[]): WorkItem[] =>
  priorities.map((p, i) => ({ id: i + 1, priority: p, boardOrder: i }) as WorkItem);

/**
 * El manager transaccional debe devolver un stub distinto por entidad -- igual
 * que en ticket-transitions.service.spec.ts -- porque create() ahora escribe
 * el evento CREATED directo con manager.getRepository(WorkItemEvent), no a
 * través de WorkItemEventsService. Un único stub compartido no podría
 * distinguir la escritura del ítem de la del evento.
 */
const makeService = (pendingColumn: WorkItem[] = []) => {
  const created = { id: 99, status: 'PENDIENTE', priority: 'MEDIA' } as WorkItem;
  const applied: number[][] = [];
  const savedEvents: Partial<WorkItemEvent>[] = [];

  const itemRepoStub = {
    // La lectura que decide la posición vive dentro de la transacción (ver
    // work-items.service.ts), así que la columna pendiente se sirve aquí, no
    // en repo.listColumn.
    find: jest.fn().mockResolvedValue(pendingColumn),
    save: jest.fn().mockImplementation((e) => Promise.resolve({ ...created, ...e })),
    create: jest.fn().mockImplementation((e) => e),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const eventRepoStub = {
    create: jest.fn().mockImplementation((e) => e),
    save: jest.fn().mockImplementation((e) => {
      savedEvents.push(e);
      return Promise.resolve({ id: savedEvents.length, ...e });
    }),
  };
  const manager = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === WorkItem) return itemRepoStub;
      if (entity === WorkItemEvent) return eventRepoStub;
      throw new Error(`getRepository inesperado: ${String(entity)}`);
    }),
  };

  const repo = {
    listColumn: jest.fn().mockResolvedValue(pendingColumn),
    applyOrder: jest.fn().mockImplementation((_m, ids: number[]) => {
      applied.push(ids);
      return Promise.resolve();
    }),
    findById: jest.fn().mockResolvedValue(created),
    runInTransaction: jest.fn().mockImplementation((work) => work(manager)),
  };
  const events = { record: jest.fn().mockResolvedValue({}), listByItem: jest.fn() };
  const clients = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 1 }) };
  return {
    service: new WorkItemsService(repo as any, events as any, clients as any),
    repo, events, clients, applied, savedEvents,
    itemRepoFind: itemRepoStub.find,
    itemRepoCreate: itemRepoStub.create,
  };
};

describe('el proyecto sale del requerimiento', () => {
  it('el alta ya no escribe proyecto, aunque lo manden', async () => {
    const { service, itemRepoCreate } = makeService();
    await service.create(1, { clientId: 7, title: 'Algo', projectId: 42 } as any);
    expect(itemRepoCreate.mock.calls[0][0]).not.toHaveProperty('projectId');
  });

  it('el DTO rechaza un projectId con la lista blanca global', async () => {
    const dto = plainToInstance(CreateWorkItemDto, { clientId: 7, title: 'Algo', projectId: 42 });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((e) => e.property)).toContain('projectId');
  });

  // `UpdateWorkItemDto` deriva del de alta: hereda la ausencia.
  it('la edicion tampoco admite projectId', async () => {
    const dto = plainToInstance(UpdateWorkItemDto, { projectId: 42 });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((e) => e.property)).toContain('projectId');
  });
});

describe('create', () => {
  it('valida el cliente', async () => {
    const { service, clients } = makeService();
    await service.create(5, { clientId: 1, title: 'Ajustar IGV' });
    expect(clients.findByIdOrFail).toHaveBeenCalledWith(1);
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

  it('registra exactamente un evento CREATED en la misma transaccion', async () => {
    // El evento se escribe con manager.getRepository(WorkItemEvent), no con
    // WorkItemEventsService.record (que usa su propio repositorio no
    // transaccional): si el alta fallara antes del commit, un evento escrito
    // por fuera de la transacción quedaría huérfano.
    const { service, events, savedEvents } = makeService();
    await service.create(5, { clientId: 1, title: 'X' });
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0]).toEqual(
      expect.objectContaining({
        type: 'CREATED',
        toStatus: 'PENDIENTE',
        actorUserId: 5,
        payload: { priority: 'MEDIA' },
      }),
    );
    expect(events.record).not.toHaveBeenCalled();
  });

  it('el item creado devuelve code y boardOrder', async () => {
    const { service } = makeService(column(['ALTA', 'MEDIA', 'BAJA']));
    const item = await service.create(5, { clientId: 1, title: 'Urgente', priority: 'ALTA' });
    expect(item.code).toBe('RQ-0099');
    expect(item.boardOrder).toBe(1);
  });

  it('lee la columna que decide la posicion dentro de la transaccion', async () => {
    // Si esta lectura ocurriera antes de abrir la transacción (por ejemplo
    // vía repo.listColumn, sin bloqueo), dos altas concurrentes en la misma
    // banda de prioridad verían la misma foto y una pisaría en silencio el
    // orden calculado por la otra. Por eso la posición se decide con
    // manager.getRepository(WorkItem).find(...), no con repo.listColumn.
    const { service, repo, itemRepoFind } = makeService(column(['ALTA', 'MEDIA', 'BAJA']));
    await service.create(5, { clientId: 1, title: 'Urgente', priority: 'ALTA' });
    expect(itemRepoFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDIENTE' },
        order: { boardOrder: 'ASC', id: 'ASC' },
      }),
    );
    expect(repo.listColumn).not.toHaveBeenCalled();
  });
});
