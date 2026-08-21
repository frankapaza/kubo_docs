import { PortalRequirementsService } from './portal-requirements.service';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { WorkItemEvent } from '../work-items/entities/work-item-event.entity';

/**
 * Doble de `WorkItemsRepository`, siguiendo el estilo de
 * `work-items.service.spec.ts`: el manager transaccional expone un stub por
 * entidad porque `create()` escribe el ítem y el evento con
 * `manager.getRepository(...)`, no con un servicio externo.
 *
 * `filas` y `eventos` siembran lo que devuelven las lecturas (`list`,
 * `findById`) para las pruebas de listado y detalle de la tarea 7, que
 * reutiliza este mismo `makeService`. Las pruebas de alta de esta tarea lo
 * llaman sin argumentos: no hay nada que leer antes de escribir.
 *
 * `guardado` y `eventos` (el valor de retorno) se mutan en el sitio -- nunca
 * se reasignan -- para que la referencia que ya tiene el test vea el
 * resultado final tras el `await service.create(...)`.
 */
function makeService(filas: Partial<WorkItem>[] = [], eventosSemilla: Partial<WorkItemEvent>[] = []) {
  const guardado: Partial<WorkItem> = {};
  const eventos: Partial<WorkItemEvent>[] = [];

  const itemRepoStub = {
    create: jest.fn().mockImplementation((e) => e),
    save: jest.fn().mockImplementation((e) => {
      Object.assign(guardado, e);
      return Promise.resolve({ id: 1, ...e });
    }),
    update: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue(filas),
    findOne: jest.fn().mockResolvedValue(filas[0] ?? null),
  };
  const eventRepoStub = {
    create: jest.fn().mockImplementation((e) => e),
    save: jest.fn().mockImplementation((e) => {
      eventos.push(e);
      return Promise.resolve({ id: eventos.length, ...e });
    }),
    find: jest.fn().mockResolvedValue(eventosSemilla),
  };
  const manager = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === WorkItem) return itemRepoStub;
      if (entity === WorkItemEvent) return eventRepoStub;
      throw new Error(`getRepository inesperado: ${String(entity)}`);
    }),
  };

  const repo = {
    list: jest.fn().mockResolvedValue(filas),
    findById: jest.fn().mockImplementation((id: number) =>
      Promise.resolve(filas.find((f) => Number(f.id) === Number(id)) ?? filas[0] ?? null),
    ),
    runInTransaction: jest.fn().mockImplementation((work) => work(manager)),
  };

  const service = new PortalRequirementsService(repo as any);
  return { service, guardado, eventos, repo };
}

describe('PortalRequirementsService.create', () => {
  it('nace en SOLICITADO, con origen PORTAL y sin autor interno', async () => {
    const { service, guardado } = makeService();

    await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'Desde el listado' });

    expect(guardado.status).toBe('SOLICITADO');
    expect(guardado.origin).toBe('PORTAL');
    expect(guardado.clientId).toBe(7);
    expect(guardado.createdByClientUserId).toBe(9);
    // Nulo, no 0: no hubo ningún usuario interno. Un 0 sería una referencia
    // a un usuario que no existe.
    expect(guardado.createdBy).toBeNull();
  });

  it('no ocupa posición en el tablero', async () => {
    const { service, guardado } = makeService();
    await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'x' });
    // Un SOLICITADO no está en ninguna columna. La posición se calcula al
    // aceptar, no antes.
    expect(guardado.boardOrder).toBe(0);
  });

  it('escribe el evento REQUESTED con el actor de cliente', async () => {
    const { service, eventos } = makeService();
    await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'x' });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      type: 'REQUESTED',
      toStatus: 'SOLICITADO',
      actorUserId: null,
      actorClientUserId: 9,
    });
  });

  it('devuelve la vista del portal, sin prioridad todavía', async () => {
    const { service } = makeService();
    const vista = await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'x' });
    expect(vista.status).toBe('Solicitado');
    expect(vista.priority).toBeNull();
    expect(vista.committedDate).toBeNull();
    expect(vista.rejectionReason).toBeNull();
    expect(vista.code).toBe('RQ-0001');
  });

  it('rechaza una sesión sin empresa utilizable', async () => {
    const { service } = makeService();
    await expect(service.create(9, 0, { title: 'x'.repeat(5), descriptionMd: 'y' }))
      .rejects.toThrow(/no identifica a ninguna empresa/i);
    await expect(service.create(0, 7, { title: 'x'.repeat(5), descriptionMd: 'y' }))
      .rejects.toThrow(/no identifica a ninguna empresa/i);
  });
});
