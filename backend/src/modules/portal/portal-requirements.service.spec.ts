import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PortalRequirementsService } from './portal-requirements.service';
import { CreatePortalRequirementDto } from './dto/create-portal-requirement.dto';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { WorkItemEvent } from '../work-items/entities/work-item-event.entity';

/**
 * Compara cada clave de `criterio` contra `fila`. Sirve tanto para
 * `WorkItemsRepository.list(filtros)` como para `Repository.findOne({ where })`:
 * las dos formas en que TypeORM recibe "qué buscar". Los ids llegan como
 * número o como cadena según la columna, de ahí la comparación por `String`.
 */
const cumple = (fila: Record<string, unknown>, criterio: Record<string, unknown> = {}) =>
  Object.entries(criterio).every(([clave, valor]) => {
    if (valor === undefined) return true;
    return String(fila[clave]) === String(valor);
  });

/**
 * Doble de `WorkItemsRepository`, siguiendo el estilo de
 * `work-items.service.spec.ts`: el manager transaccional expone un stub por
 * entidad porque `create()` escribe el ítem y el evento con
 * `manager.getRepository(...)`, no con un servicio externo.
 *
 * `filas` siembra `repo.list` / `repo.findById` / `itemRepo.findOne`, y estos
 * **filtran de verdad** sobre el criterio que reciben, no devuelven siempre lo
 * mismo: una prueba de listado de la tarea 7 que se olvide `clientId` u
 * `origin: 'PORTAL'` en el filtro tiene que poder fallar, no verse tapada por
 * un doble ciego. Por la misma razón `findById`/`findOne` devuelven `null`
 * cuando no hay match, nunca la primera fila de la lista: eso es lo que
 * distingue "no existe" de "es de otra empresa" en una prueba de 404.
 *
 * `eventosSemilla` prepara el lado de lectura de eventos para la tarea 7.
 * `PortalRequirementsService.create` hoy solo **escribe** eventos (con el
 * manager transaccional); el camino real de **lectura** en esta casa es
 * `WorkItemEventsService.listByItem`, no transaccional (mismo patrón que
 * `WorkItemsService.findWithTimeline` y que `PortalTicketsService.detail` con
 * `TicketEventsService.listByTicket`) — un `manager.getRepository(...)` solo
 * existe durante una escritura, nunca durante una lectura, así que sembrar la
 * semilla ahí sería un doble que aparenta funcionar sin que nada lo llame
 * nunca. Por eso el doble tiene la forma de `WorkItemEventsService`
 * (`listByItem`) y se devuelve sin usar: cuando la tarea 7 añada esa
 * dependencia al constructor, ya está listo para inyectarse.
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
    // Sin cablear a `filas` a propósito: create() no lee la columna
    // PENDIENTE (a diferencia de WorkItemsService.create), así que una
    // llamada a `find` aquí sería justo el bug que "no ocupa posición en el
    // tablero" tiene que detectar.
    find: jest.fn().mockResolvedValue(filas),
    findOne: jest.fn().mockImplementation((opciones: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve(filas.find((f) => cumple(f as Record<string, unknown>, opciones.where)) ?? null),
    ),
  };
  const eventRepoStub = {
    create: jest.fn().mockImplementation((e) => e),
    save: jest.fn().mockImplementation((e) => {
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
    list: jest.fn().mockImplementation((filtros: Record<string, unknown> = {}) =>
      Promise.resolve(filas.filter((f) => cumple(f as Record<string, unknown>, filtros))),
    ),
    findById: jest.fn().mockImplementation((id: number) =>
      Promise.resolve(filas.find((f) => String((f as Record<string, unknown>).id) === String(id)) ?? null),
    ),
    runInTransaction: jest.fn().mockImplementation((work) => work(manager)),
  };

  const eventsService = { listByItem: jest.fn().mockResolvedValue(eventosSemilla) };

  const service = new PortalRequirementsService(repo as any);
  return {
    service,
    guardado,
    eventos,
    repo,
    itemRepo: itemRepoStub,
    eventRepo: eventRepoStub,
    eventsService,
  };
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

  it('no ocupa posición en el tablero: no toca la columna PENDIENTE', async () => {
    const { service, guardado, itemRepo } = makeService();
    await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'x' });
    // Un SOLICITADO no está en ninguna columna. Comprobar solo boardOrder===0
    // no basta: con la columna vacía, insertionIndex([], 'MEDIA') también da
    // 0, así que una implementación que sí leyera y renumerara PENDIENTE
    // pasaría igual. Lo que hay que ver es que ni siquiera se consulta.
    expect(itemRepo.find).not.toHaveBeenCalled();
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

  it('persiste el código RQ- con update, no solo lo calcula para la respuesta', async () => {
    const { service, itemRepo } = makeService();
    await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'x' });
    // La vista arma `code` con la variable local `code`: si se borrara el
    // `await itemRepo.update(saved.id, { code })`, las demás pruebas
    // seguirían en verde y la fila quedaría con code = NULL en la base.
    expect(itemRepo.update).toHaveBeenCalledWith(1, { code: 'RQ-0001' });
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

  it('publica exactamente el conjunto de campos acordado, ni uno mas', async () => {
    const { service } = makeService();
    const vista = await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'x' });
    // Con un `{...w}` de por medio esta prueba detectaría clientId,
    // boardOrder, assigneeUserId, createdBy, projectId, labels... -- nada de
    // eso está en la lista blanca de PortalRequirementView.
    expect(Object.keys(vista).sort()).toEqual(
      [
        'closedAt',
        'code',
        'committedDate',
        'createdAt',
        'descriptionMd',
        'id',
        'priority',
        'rejectionReason',
        'status',
        'title',
      ].sort(),
    );
  });

  it('rechaza una sesión sin empresa utilizable', async () => {
    const { service } = makeService();
    await expect(service.create(9, 0, { title: 'x'.repeat(5), descriptionMd: 'y' }))
      .rejects.toThrow(/no identifica a ninguna empresa/i);
    await expect(service.create(0, 7, { title: 'x'.repeat(5), descriptionMd: 'y' }))
      .rejects.toThrow(/no identifica a ninguna empresa/i);
  });
});

describe('el dto de alta', () => {
  const validar = async (dto: Record<string, unknown>) => {
    const instancia = plainToInstance(CreatePortalRequirementDto, dto);
    const errores = await validate(instancia);
    return errores.flatMap((e) => Object.values(e.constraints ?? {}));
  };

  const base = { title: 'Exportar a Excel', descriptionMd: 'Desde el listado' };

  it('acepta el alta minima', async () => {
    expect(await validar(base)).toEqual([]);
  });

  /**
   * Sin `message` en los decoradores, el ValidationPipe global deja pasar el
   * literal de class-validator tal cual: inglés y con el nombre interno de la
   * propiedad dentro (`descriptionMd must be shorter than...`). Es justo lo
   * que `portal-validation.integration.spec.ts` prohíbe con sus listas negras
   * `ENGLISH_LEAKS` e `INTERNAL_PROPERTY_NAMES` -- que incluye `descriptionMd`
   * en persona.
   */
  it('los mensajes van en español y sin el nombre interno de la propiedad', async () => {
    const mensajes = await validar({ title: 'ab', descriptionMd: 'xy' });
    expect(mensajes.length).toBeGreaterThan(0);
    mensajes.forEach((m) => {
      expect(m.toLowerCase()).not.toMatch(/must be|should not|shorter than|longer than/);
      expect(m).not.toContain('descriptionMd');
    });
  });

  it('acota el titulo a los 240 de su columna, minimo 3', async () => {
    expect(await validar({ ...base, title: 'ab' })).not.toEqual([]);
    expect(await validar({ ...base, title: 'a'.repeat(240) })).toEqual([]);
    expect(await validar({ ...base, title: 'a'.repeat(241) })).not.toEqual([]);
  });

  // `description_md` es TEXT utf8mb4: 65535 *bytes*, no caracteres. 16383 es
  // la mayor longitud que cabe siempre (65532 bytes en el peor caso), mismo
  // razonamiento que `create-portal-ticket.dto.ts`.
  it('acota la descripcion a lo que cabe de verdad en la columna', async () => {
    expect(await validar({ ...base, descriptionMd: 'a'.repeat(16383) })).toEqual([]);
    expect(await validar({ ...base, descriptionMd: 'a'.repeat(16384) })).not.toEqual([]);
  });

  it('un titulo de solo espacios no pasa: el trim va antes de validar', async () => {
    expect(await validar({ ...base, title: '   ' })).not.toEqual([]);
  });
});
