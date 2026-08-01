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
 *
 * `current` es lo que devuelve repo.findById (el chequeo temprano, fuera de
 * la transacción); `freshCurrent` (por defecto igual a `current`) es lo que
 * devuelve itemRepo.findOne dentro de ella. Separarlos permite simular una
 * foto vieja: dos operaciones sobre el mismo ítem donde la que abrió la
 * transacción después ve un estado distinto al que existía cuando se hizo el
 * chequeo temprano.
 */
const makeService = (
  current: WorkItem,
  columns: Record<string, WorkItem[]> = {},
  freshCurrent: WorkItem = current,
) => {
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
    findOne: jest.fn().mockResolvedValue(freshCurrent),
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

  it('limpia closed_at al cancelar un item cerrado', async () => {
    const { service, patches } = makeService(item({ status: 'CERRADO', closedAt: new Date() }));
    await service.move({
      workItemId: 2,
      actorUserId: 5,
      toStatus: 'CANCELADO',
      toIndex: 0,
      reason: 'Ya no aplica',
    });
    expect(patches.some((p) => p.closedAt === null)).toBe(true);
  });

  it('lee el item dentro de la transaccion antes de decidir, no solo el chequeo temprano', async () => {
    const { service, itemRepoStub } = makeService(item());
    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'EN_PROCESO', toIndex: 0 });
    expect(itemRepoStub.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2 } }),
    );
  });

  it('reordena dentro de CERRADO sin tocar closed_at ni escribir evento', async () => {
    const closedAt = new Date('2026-01-01T10:00:00Z');
    const cols = {
      CERRADO: [
        item({ id: 1, status: 'CERRADO', closedAt: new Date('2026-01-02T10:00:00Z') }),
        item({ id: 2, status: 'CERRADO', closedAt }),
        item({ id: 3, status: 'CERRADO', closedAt: new Date('2026-01-03T10:00:00Z') }),
      ],
    };
    const { service, patches, savedEvents } = makeService(item({ id: 2, status: 'CERRADO', closedAt }), cols);

    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'CERRADO', toIndex: 0 });

    expect(patches.some((p) => 'closedAt' in p)).toBe(false);
    expect(savedEvents).toHaveLength(0);
  });

  it('reordena dentro de BLOQUEADO sin motivo y no escribe evento', async () => {
    const cols = {
      BLOQUEADO: [
        item({ id: 1, status: 'BLOQUEADO' }),
        item({ id: 2, status: 'BLOQUEADO' }),
      ],
    };
    const { service, savedEvents } = makeService(item({ id: 2, status: 'BLOQUEADO' }), cols);

    await expect(
      service.move({ workItemId: 2, actorUserId: 5, toStatus: 'BLOQUEADO', toIndex: 0 }),
    ).resolves.toBeDefined();
    expect(savedEvents).toHaveLength(0);
  });

  it('decide con el estado fresco de la transaccion, no con la foto previa a abrirla', async () => {
    // El chequeo temprano (repo.findById) ve el ítem todavía EN_PROCESO; para
    // cuando la transacción abre y relee, alguien más ya lo cerró. Si el
    // servicio usara la foto vieja para decidir `from`, no limpiaría
    // closed_at al salir de CERRADO ni marcaria el evento como REOPENED.
    const stale = item({ status: 'EN_PROCESO', closedAt: null });
    const fresh = item({ status: 'CERRADO', closedAt: new Date() });
    const { service, patches, savedEvents } = makeService(stale, {}, fresh);

    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'PRUEBAS', toIndex: 0 });

    expect(patches.some((p) => p.closedAt === null)).toBe(true);
    expect(savedEvents).toContainEqual(
      expect.objectContaining({ type: 'REOPENED', fromStatus: 'CERRADO', toStatus: 'PRUEBAS' }),
    );
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

  it('usa la prioridad fresca de la transaccion para el payload, no la foto previa a abrirla', async () => {
    // El chequeo temprano ve MEDIA; para cuando la transacción relee, alguien
    // más ya la cambió a BAJA. El payload.from debe reflejar BAJA, no MEDIA.
    const stale = item({ priority: 'MEDIA' });
    const fresh = item({ priority: 'BAJA' });
    const { service, savedEvents } = makeService(stale, {}, fresh);

    await service.changePriority({ workItemId: 2, actorUserId: 5, priority: 'ALTA' });

    expect(savedEvents).toContainEqual(
      expect.objectContaining({ payload: { from: 'BAJA', to: 'ALTA' } }),
    );
  });
});
