import { WorkItemIntakeService } from './work-item-intake.service';
import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';

const fila = (over: Partial<WorkItem> = {}): WorkItem =>
  ({ id: 1, status: 'SOLICITADO', priority: 'MEDIA', boardOrder: 0, dueDate: null, ...over }) as WorkItem;

/**
 * Mismo patrón que work-item-board.service.spec.ts: el manager transaccional
 * necesita un stub por entidad porque accept/reject escriben el evento
 * directo con manager.getRepository(WorkItemEvent), y la columna PENDIENTE se
 * lee dentro de la transacción vía manager.getRepository(WorkItem).find(...).
 *
 * `patches` y `eventos` son arrays que se destructuran ANTES del `await` y se
 * mutan por referencia (push) durante la llamada: por eso siguen viendo lo
 * que ocurre después, a diferencia de un valor primitivo que quedaría
 * congelado en el momento de la desestructuración. `orden` guarda cada
 * llamada a applyOrder (como máximo una, y ninguna en reject).
 */
const makeService = (current: WorkItem, columnaPendiente: WorkItem[] = []) => {
  const patches: Array<Record<string, unknown>> = [];
  const eventos: Array<Partial<WorkItemEvent>> = [];
  const orden: number[][] = [];

  const itemRepoStub = {
    findOne: jest.fn().mockResolvedValue(current),
    find: jest.fn().mockResolvedValue(columnaPendiente),
    update: jest.fn().mockImplementation((_id: number, p: Record<string, unknown>) => {
      patches.push(p);
      return Promise.resolve(undefined);
    }),
  };
  const eventRepoStub = {
    create: jest.fn().mockImplementation((e: Partial<WorkItemEvent>) => e),
    save: jest.fn().mockImplementation((e: Partial<WorkItemEvent>) => {
      eventos.push(e);
      return Promise.resolve({ id: eventos.length, ...e });
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
    runInTransaction: jest.fn().mockImplementation((work: (m: unknown) => Promise<unknown>) => work(manager)),
    applyOrder: jest.fn().mockImplementation((_m: unknown, ids: number[]) => {
      orden.push(ids);
      return Promise.resolve();
    }),
  };

  return {
    service: new WorkItemIntakeService(repo as any),
    patches,
    eventos,
    orden,
  };
};

describe('WorkItemIntakeService.accept', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('pasa a PENDIENTE fijando prioridad y fecha comprometida', async () => {
    const { service, patches } = makeService(fila({ status: 'SOLICITADO' }));
    await service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-09-30' });
    expect(patches[0]).toMatchObject({ status: 'PENDIENTE', priority: 'ALTA', dueDate: '2026-09-30' });
  });

  it('escribe el evento ACCEPTED con el actor interno', async () => {
    const { service, eventos } = makeService(fila({ status: 'SOLICITADO' }));
    await service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-09-30' });
    expect(eventos[0]).toMatchObject({
      type: 'ACCEPTED',
      fromStatus: 'SOLICITADO',
      toStatus: 'PENDIENTE',
      actorUserId: 5,
    });
  });

  it('lo coloca en la columna PENDIENTE por su banda de prioridad', async () => {
    const { service, orden } = makeService(fila({ id: 9, status: 'SOLICITADO' }), [
      fila({ id: 1, status: 'PENDIENTE', priority: 'ALTA' }),
      fila({ id: 2, status: 'PENDIENTE', priority: 'BAJA' }),
    ]);
    await service.accept(9, 5, { priority: 'MEDIA', committedDate: '2026-09-30' });
    // Un MEDIA nuevo aterriza sobre los BAJA y debajo de los ALTA.
    expect(orden[0]).toEqual([1, 9, 2]);
  });

  it('rechaza una fecha comprometida anterior a hoy', async () => {
    // Fecha del sistema fija: comparar contra la fecha real haría que esta
    // prueba dejara de ser cierta con el paso del tiempo.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-07T12:00:00'));
    const { service } = makeService(fila({ status: 'SOLICITADO' }));
    await expect(service.accept(1, 5, { priority: 'ALTA', committedDate: '2020-01-01' }))
      .rejects.toThrow(/anterior a hoy/i);
  });

  it('no acepta lo que no está en SOLICITADO', async () => {
    const { service } = makeService(fila({ status: 'EN_PROCESO' }));
    await expect(service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-09-30' }))
      .rejects.toThrow(/no está pendiente de aceptación/i);
  });

  it('no escribe nada cuando rechaza la aceptación', async () => {
    const { service, patches, eventos } = makeService(fila({ status: 'CERRADO' }));
    await expect(service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-09-30' }))
      .rejects.toThrow();
    expect(patches).toHaveLength(0);
    expect(eventos).toHaveLength(0);
  });
});

describe('WorkItemIntakeService.reject', () => {
  it('pasa a RECHAZADO y guarda el motivo en el evento', async () => {
    const { service, patches, eventos } = makeService(fila({ status: 'SOLICITADO' }));
    await service.reject(1, 5, { reason: 'Fuera del alcance del contrato' });
    expect(patches[0]).toMatchObject({ status: 'RECHAZADO' });
    expect(eventos[0]).toMatchObject({
      type: 'REJECTED',
      toStatus: 'RECHAZADO',
      reason: 'Fuera del alcance del contrato',
    });
  });

  it('no rechaza lo que no está en SOLICITADO, y no escribe nada', async () => {
    const { service, patches, eventos } = makeService(fila({ status: 'PENDIENTE' }));
    await expect(service.reject(1, 5, { reason: 'Ya no aplica' }))
      .rejects.toThrow(/no está pendiente de aceptación/i);
    expect(patches).toHaveLength(0);
    expect(eventos).toHaveLength(0);
  });
});
