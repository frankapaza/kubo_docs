import { WorkItemBoardService } from './work-item-board.service';
import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';

const item = (over: Partial<WorkItem> = {}): WorkItem =>
  ({ id: 2, status: 'PENDIENTE', priority: 'MEDIA', boardOrder: 1, closedAt: null, ...over }) as WorkItem;

/**
 * El manager transaccional necesita un stub distinto por entidad -- igual que
 * en work-items.service.spec.ts -- porque los tres métodos de este servicio
 * escriben el evento directo con manager.getRepository(WorkItemEvent), no a
 * través de WorkItemEventsService.record (que usa su propio repositorio no
 * transaccional: si la escritura del ítem se revirtiera, el evento quedaría
 * huérfano). Por la misma razón la columna se lee dentro de la transacción,
 * vía manager.getRepository(WorkItem).find(...), en vez de repo.listColumn
 * (que no participa del bloqueo transaccional).
 */
const makeService = (current: WorkItem, columns: Record<string, WorkItem[]> = {}) => {
  const applied: number[][] = [];
  const patches: Array<Record<string, unknown>> = [];
  const savedEvents: Array<Partial<WorkItemEvent>> = [];

  const itemRepoStub = {
    find: jest.fn().mockImplementation((q: { where: { status: string } }) =>
      Promise.resolve(columns[q.where.status] ?? []),
    ),
    update: jest.fn().mockImplementation((_id: number, p: Record<string, unknown>) => {
      patches.push(p);
      return Promise.resolve(undefined);
    }),
    findOne: jest.fn().mockResolvedValue(current),
  };
  const eventRepoStub = {
    create: jest.fn().mockImplementation((e: Partial<WorkItemEvent>) => e),
    save: jest.fn().mockImplementation((e: Partial<WorkItemEvent>) => {
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
    findById: jest.fn().mockResolvedValue(current),
    listColumn: jest.fn(),
    applyOrder: jest.fn().mockImplementation((_m: unknown, ids: number[]) => {
      applied.push(ids);
      return Promise.resolve();
    }),
    runInTransaction: jest.fn().mockImplementation((work: (m: unknown) => Promise<unknown>) => work(manager)),
  };
  const events = {
    record: jest.fn().mockResolvedValue({}),
    typeForMove: jest.fn().mockImplementation((from: string, to: string) => {
      if (to === 'BLOQUEADO') return 'BLOCKED';
      if (to === 'CANCELADO') return 'CANCELLED';
      if (to === 'CERRADO') return 'CLOSED';
      if (from === 'CERRADO') return 'REOPENED';
      if (from === 'BLOQUEADO') return 'UNBLOCKED';
      return 'MOVED';
    }),
  };

  return {
    service: new WorkItemBoardService(repo as any, events as any),
    repo,
    events,
    applied,
    patches,
    savedEvents,
    itemRepoStub,
  };
};

describe('move', () => {
  it('rechaza pasar a BLOQUEADO sin motivo y no escribe nada', async () => {
    const { service, patches, savedEvents } = makeService(item());
    await expect(
      service.move({ workItemId: 2, actorUserId: 5, toStatus: 'BLOQUEADO', toIndex: 0 }),
    ).rejects.toThrow();
    expect(patches).toHaveLength(0);
    expect(savedEvents).toHaveLength(0);
  });

  it('rechaza pasar a CANCELADO sin motivo y no escribe nada', async () => {
    const { service, patches, savedEvents } = makeService(item());
    await expect(
      service.move({ workItemId: 2, actorUserId: 5, toStatus: 'CANCELADO', toIndex: 0 }),
    ).rejects.toThrow();
    expect(patches).toHaveLength(0);
    expect(savedEvents).toHaveLength(0);
  });

  it('acepta BLOQUEADO con motivo y lo registra en la transaccion, no via events.record', async () => {
    const { service, events, savedEvents } = makeService(item());
    await service.move({
      workItemId: 2,
      actorUserId: 5,
      toStatus: 'BLOQUEADO',
      toIndex: 0,
      reason: 'Esperando respuesta del cliente',
    });
    expect(savedEvents).toContainEqual(
      expect.objectContaining({
        type: 'BLOCKED',
        reason: 'Esperando respuesta del cliente',
        toStatus: 'BLOQUEADO',
        fromStatus: 'PENDIENTE',
      }),
    );
    expect(events.record).not.toHaveBeenCalled();
  });

  it('reordena dentro de la misma columna y renumera una sola vez, leyendo la columna dentro de la transaccion', async () => {
    const cols = {
      PENDIENTE: [item({ id: 1, boardOrder: 0 }), item({ id: 2, boardOrder: 1 }), item({ id: 3, boardOrder: 2 })],
    };
    const { service, repo, applied, itemRepoStub } = makeService(item({ id: 2 }), cols);
    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'PENDIENTE', toIndex: 0 });
    expect(applied).toEqual([[2, 1, 3]]);
    expect(itemRepoStub.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDIENTE' },
        order: { boardOrder: 'ASC', id: 'ASC' },
      }),
    );
    expect(repo.listColumn).not.toHaveBeenCalled();
  });

  it('al cambiar de columna renumera origen y destino', async () => {
    const cols = {
      PENDIENTE: [item({ id: 1 }), item({ id: 2 })],
      EN_PROCESO: [item({ id: 7, status: 'EN_PROCESO' })],
    };
    const { service, applied } = makeService(item({ id: 2 }), cols);
    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'EN_PROCESO', toIndex: 0 });
    expect(applied).toContainEqual([1]); // origen sin el movido
    expect(applied).toContainEqual([2, 7]); // destino con el movido arriba
  });

  it('sella closed_at al cerrar', async () => {
    const { service, patches } = makeService(item());
    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'CERRADO', toIndex: 0 });
    expect(patches.some((p) => p.closedAt instanceof Date)).toBe(true);
  });

  it('limpia closed_at al reabrir', async () => {
    const { service, patches } = makeService(item({ status: 'CERRADO', closedAt: new Date() }));
    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'EN_PROCESO', toIndex: 0 });
    expect(patches.some((p) => p.closedAt === null)).toBe(true);
  });
});

describe('assign', () => {
  it('escribe el asignado y registra ASSIGNED en la transaccion', async () => {
    const { service, patches, events, savedEvents } = makeService(item());
    await service.assign({ workItemId: 2, actorUserId: 5, assigneeUserId: 11 });
    expect(patches.some((p) => p.assigneeUserId === 11)).toBe(true);
    expect(savedEvents).toContainEqual(
      expect.objectContaining({
        type: 'ASSIGNED',
        workItemId: 2,
        actorUserId: 5,
        reason: null,
        payload: { assigneeUserId: 11 },
      }),
    );
    expect(events.record).not.toHaveBeenCalled();
  });
});

describe('changePriority', () => {
  it('escribe la prioridad y registra PRIORITY_CHANGED con el valor anterior, sin reordenar', async () => {
    const { service, patches, events, savedEvents, applied } = makeService(item({ priority: 'BAJA' }));
    await service.changePriority({ workItemId: 2, actorUserId: 5, priority: 'ALTA' });
    expect(patches.some((p) => p.priority === 'ALTA')).toBe(true);
    expect(savedEvents).toContainEqual(
      expect.objectContaining({
        type: 'PRIORITY_CHANGED',
        payload: { from: 'BAJA', to: 'ALTA' },
      }),
    );
    expect(events.record).not.toHaveBeenCalled();
    expect(applied).toHaveLength(0);
  });
});
