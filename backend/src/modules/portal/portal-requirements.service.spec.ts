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
 * Fila base de `work_items` para las pruebas de lectura (tarea 7). Cada
 * prueba solo declara lo que le importa; el resto son valores neutros que no
 * condicionan `toPortalView`.
 */
function fila(overrides: Partial<WorkItem> = {}): Partial<WorkItem> {
  return {
    id: 1,
    code: 'RQ-0001',
    clientId: 7,
    origin: 'PORTAL',
    title: 'Exportar a Excel',
    descriptionMd: 'Descripción',
    status: 'SOLICITADO',
    priority: 'MEDIA',
    dueDate: null,
    closedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Doble de `WorkItemsRepository`, siguiendo el estilo de
 * `work-items.service.spec.ts`: el manager transaccional expone un stub por
 * entidad porque `create()` escribe el ítem y el evento con
 * `manager.getRepository(...)`, no con un servicio externo.
 *
 * `listPortalRequirements` / `findPortalRequirement` / `lastRejectionReason`
 * son los tres métodos que la tarea 7 añade a `WorkItemsRepository`, y aquí
 * **filtran de verdad** sobre `filas` / `eventosSemilla`, no devuelven
 * siempre lo mismo: una prueba de listado que se olvide `clientId` u
 * `origin: 'PORTAL'` en el filtro tiene que poder fallar, no verse tapada por
 * un doble ciego. Por la misma razón `findPortalRequirement` devuelve `null`
 * cuando no hay match, nunca la primera fila de la lista: eso es lo que
 * distingue "no existe" de "es de otra empresa" en una prueba de 404.
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
    // Los dos filtros juntos, sin `if` que los rodee: igual que la
    // implementación real, el doble no puede "olvidarlos" a medias.
    listPortalRequirements: jest.fn().mockImplementation((clientId: number) =>
      Promise.resolve(
        filas.filter((f) => cumple(f as Record<string, unknown>, { clientId, origin: 'PORTAL' })),
      ),
    ),
    findPortalRequirement: jest.fn().mockImplementation((clientId: number, id: number) =>
      Promise.resolve(
        filas.find((f) =>
          cumple(f as Record<string, unknown>, { id, clientId, origin: 'PORTAL' }),
        ) ?? null,
      ),
    ),
    lastRejectionReason: jest.fn().mockImplementation((workItemId: number) => {
      const del = eventosSemilla.filter((e) =>
        cumple(e as Record<string, unknown>, { workItemId, type: 'REJECTED' }),
      );
      return Promise.resolve(del.length > 0 ? (del[del.length - 1].reason ?? null) : null);
    }),
    runInTransaction: jest.fn().mockImplementation((work) => work(manager)),
  };

  const service = new PortalRequirementsService(repo as any);
  return {
    service,
    guardado,
    eventos,
    repo,
    itemRepo: itemRepoStub,
    eventRepo: eventRepoStub,
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

describe('PortalRequirementsService.list', () => {
  it('devuelve solo los del portal de la propia empresa', async () => {
    const { service } = makeService([
      fila({ id: 1, clientId: 7, origin: 'PORTAL' }),
      fila({ id: 2, clientId: 7, origin: 'INTERNO' }), // trabajo interno
      fila({ id: 3, clientId: 8, origin: 'PORTAL' }), // otra empresa
    ]);

    const vistas = await service.list(7);

    expect(vistas.map((v) => v.id)).toEqual([1]);
  });

  // `create` ya prueba esto; `list` no lo probaba, y un `clientId` inservible
  // colándose en el `where` de `listPortalRequirements` es exactamente la
  // forma de fallo que documenta `assertSessionScope`.
  it('rechaza una sesión sin empresa utilizable', async () => {
    const { service } = makeService();
    await expect(service.list(0)).rejects.toThrow(/no identifica a ninguna empresa/i);
  });
});

describe('PortalRequirementsService.findOne', () => {
  it('devuelve el requerimiento propio', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 7, origin: 'PORTAL' })]);
    await expect(service.findOne(7, 1)).resolves.toMatchObject({ id: 1 });
  });

  // Las dos siguientes son la frontera entre empresas. 404 y no 403: un 403
  // confirmaría que el recurso existe.
  it('da 404 con un requerimiento de otra empresa', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 8, origin: 'PORTAL' })]);
    await expect(service.findOne(7, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('da 404 con un requerimiento interno de la propia empresa', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 7, origin: 'INTERNO' })]);
    await expect(service.findOne(7, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('da el mismo cuerpo que uno inexistente', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 8, origin: 'PORTAL' })]);
    const ajeno = await service.findOne(7, 1).catch((e) => e.getResponse());
    const inexistente = await service.findOne(7, 999).catch((e) => e.getResponse());
    expect(ajeno).toEqual(inexistente);
  });

  it('publica exactamente las claves de la lista blanca', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 7, origin: 'PORTAL' })]);
    const vista = await service.findOne(7, 1);
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

  it('esconde la prioridad mientras no esté aceptado', async () => {
    const { service } = makeService([
      fila({ id: 1, clientId: 7, origin: 'PORTAL', status: 'SOLICITADO', priority: 'MEDIA' }),
    ]);
    await expect(service.findOne(7, 1)).resolves.toMatchObject({ priority: null });
  });

  /**
   * Un RECHAZADO tampoco pasó nunca por la aceptación: su `priority` en la
   * base es el `DEFAULT_PRIORITY` que le puso el alta (la columna no admite
   * nulo), no algo que la casa haya decidido. Enseñarlo sería el mismo
   * defecto que con SOLICITADO — decidir por el valor guardado en vez de por
   * el hecho («¿se aceptó?») — solo que aquí el valor de más sí está
   * presente, así que una condición que solo mirase SOLICITADO pasaría de
   * largo.
   */
  it('esconde la prioridad de un rechazado: tampoco pasó por la aceptación', async () => {
    const { service } = makeService([
      fila({ id: 1, clientId: 7, origin: 'PORTAL', status: 'RECHAZADO', priority: 'MEDIA' }),
    ]);
    await expect(service.findOne(7, 1)).resolves.toMatchObject({ priority: null });
  });

  /**
   * La decisión es por el estado, no por si `dueDate` está vacía. Con un
   * requerimiento recién creado las dos condiciones coinciden (SOLICITADO y
   * sin fecha comprometida a la vez), así que esa combinación no distingue
   * una implementación correcta de una que mirase `dueDate`. Aquí el estado
   * ya es posterior y la fecha sigue vacía: si alguien cambiara la condición
   * a "¿`dueDate` está vacío?", esta prueba tiene que fallar.
   */
  it('muestra la prioridad en un estado posterior aunque no haya fecha comprometida', async () => {
    const { service } = makeService([
      fila({ id: 1, clientId: 7, origin: 'PORTAL', status: 'EN_PROCESO', priority: 'ALTA', dueDate: null }),
    ]);
    await expect(service.findOne(7, 1)).resolves.toMatchObject({ priority: 'ALTA' });
  });

  it('trae el motivo del último evento REJECTED cuando está rechazado', async () => {
    const { service } = makeService(
      [fila({ id: 1, clientId: 7, origin: 'PORTAL', status: 'RECHAZADO' })],
      [{ workItemId: 1, type: 'REJECTED', reason: 'Fuera del alcance del contrato' }],
    );
    await expect(service.findOne(7, 1)).resolves.toMatchObject({
      status: 'Rechazado',
      rejectionReason: 'Fuera del alcance del contrato',
    });
  });

  it('rechaza una sesión sin empresa utilizable', async () => {
    const { service } = makeService();
    await expect(service.findOne(0, 1)).rejects.toThrow(/no identifica a ninguna empresa/i);
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
