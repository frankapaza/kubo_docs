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

  /**
   * `2020-01-01` (la prueba de arriba) la rechaza cualquier implementación
   * plausible, incluida una que compare instantes o que tenga el huso mal:
   * solo demuestra que "hay alguna validación de fecha", no que sea la
   * correcta. Estas dos acotan la frontera real: el propio día de hoy tiene
   * que aceptarse siempre, sea cual sea la hora a la que se acepte.
   *
   * El instante de sistema se fija con `Z` (absoluto) y no con la forma local
   * de la prueba de arriba, para que "hoy" en hora de Lima quede definido sin
   * depender de en qué zona corra el host que ejecuta la suite: 2026-08-07
   * 15:00 UTC son las 10:00 de Lima del mismo día 7.
   */
  it('acepta la fecha de hoy', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-07T15:00:00Z'));
    const { service, patches } = makeService(fila({ status: 'SOLICITADO' }));
    await service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-08-07' });
    expect(patches[0]).toMatchObject({ dueDate: '2026-08-07' });
  });

  it('acepta mañana', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-07T15:00:00Z'));
    const { service, patches } = makeService(fila({ status: 'SOLICITADO' }));
    await service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-08-08' });
    expect(patches[0]).toMatchObject({ dueDate: '2026-08-08' });
  });

  /**
   * Con el host de desarrollo ya en hora de Lima, ningún instante delata en
   * el resultado que `assertFechaNoPasada` calculara "hoy" con la zona del
   * proceso en vez de con `PERU_TIME_ZONE` escrita: las dos darían el mismo
   * día. La única forma de cazar esa regresión es estructural — comprobar
   * que el formateo que decide "hoy" lleva la zona puesta —, igual que hace
   * `notification-dispatcher.service.spec.ts` con el formateo de los correos
   * ("el formateo fija la zona, no la hereda del proceso").
   */
  it('calcula "hoy" con la zona de Lima escrita, no con la del proceso', async () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    const { service } = makeService(fila({ status: 'SOLICITADO' }));

    await service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-09-30' });

    expect(spy).toHaveBeenCalledWith('en-CA', expect.objectContaining({ timeZone: 'America/Lima' }));
    spy.mockRestore();
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
