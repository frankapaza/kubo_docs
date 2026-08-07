import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PortalTicketsService, sameId } from './portal-tickets.service';
import { CreatePortalTicketDto } from './dto/create-portal-ticket.dto';

/**
 * Un ticket "completo": trae todas las columnas sensibles que el portal NO
 * debe publicar. Si alguien añade una columna nueva a la entidad y la
 * proyección la copiara sin querer, estos tests son la red que lo detecta.
 */
const fullTicket = (over: Record<string, unknown> = {}) => ({
  id: 1,
  code: 'KB-0001',
  clientId: 7,
  projectId: 42,
  systemId: 5,
  meetingId: 9,
  origin: 'PORTAL',
  requestType: 'INCIDENCIA',
  serviceCategory: 'SOPORTE',
  subject: 'No carga el reporte',
  rawText: 'texto crudo interno',
  rawAudioFilename: 'a.ogg',
  descriptionMd: 'Descripcion elaborada',
  acceptanceCriteria: ['a'],
  labels: ['x'],
  moduleName: 'reportes',
  screenName: 'listado',
  flowContext: 'contexto interno',
  impact: 'ALTO',
  urgency: 'ALTA',
  priority: 'P1',
  priorityOverridden: 0,
  status: 'NUEVO',
  assigneeUserId: 3,
  escalationLevel: 'N2',
  slaPolicyId: 2,
  slaResponseDueAt: new Date('2026-08-01T10:00:00Z'),
  slaResolutionDueAt: new Date('2026-08-02T10:00:00Z'),
  firstResponseAt: null,
  pausedAt: null,
  pausedTotalSeconds: 0,
  slaAtRisk: 1,
  capturedAt: new Date('2026-08-01T09:00:00Z'),
  attendedAt: null,
  resolvedAt: null,
  closedAt: null,
  resolutionMd: 'solucion interna',
  rootCause: 'causa interna',
  correctiveAction: 'accion interna',
  scheduledAt: null,
  durationMinutes: null,
  jiraIntegrationId: 1,
  jiraProjectKey: 'KB',
  jiraIssueKey: 'KB-1',
  jiraIssueUrl: 'https://jira/KB-1',
  sentAt: null,
  closureDocumentId: null,
  createdBy: null,
  createdByClientUserId: 11,
  createdAt: new Date('2026-08-01T09:00:00Z'),
  updatedAt: new Date('2026-08-01T09:00:00Z'),
  ...over,
});

const fullEvent = (over: Record<string, unknown> = {}) => ({
  id: 100,
  ticketId: 1,
  type: 'CREATED',
  fromStatus: null,
  toStatus: 'NUEVO',
  actorUserId: 3,
  actorClientUserId: 11,
  reason: 'motivo interno que el cliente no debe leer',
  payload: { origin: 'PORTAL', priority: 'P1' },
  createdAt: new Date('2026-08-01T09:00:00Z'),
  ...over,
});

/**
 * El ticket de la empresa de al lado. Vive siempre en el doble del
 * repositorio: es el control negativo permanente de todos los tests de
 * listado. Si el filtro por cliente desapareciera, este ticket aparecería.
 */
const TICKET_AJENO = fullTicket({
  id: 999,
  code: 'KB-0999',
  clientId: 99,
  subject: 'Ticket confidencial de otra empresa',
  rawText: 'no debe salir jamas por el portal del cliente 7',
});

/** Los ids de la base llegan como cadena en unas columnas y número en otras. */
const mismoId = (a: unknown, b: unknown) =>
  a !== null && a !== undefined && Number(a) === Number(b);

const makeService = (ticketOver: Record<string, unknown> = {}) => {
  const ticket = fullTicket(ticketOver);

  /**
   * El doble **filtra de verdad**, no devuelve siempre lo mismo.
   *
   * Con un doble que ignorase los filtros, `expect(repo.list).toHaveBeenCalledWith(...)`
   * solo demostraría que el servicio *dice* el clientId correcto, no que la
   * respuesta esté acotada: un repositorio que se saltara el WHERE dejaría el
   * test en verde. Al filtrar aquí, las aserciones sobre lo devuelto pasan a
   * ser aserciones reales sobre la frontera.
   */
  const almacen = [ticket, TICKET_AJENO];
  const repo = {
    list: jest.fn((filters: { clientId?: number }) =>
      Promise.resolve(almacen.filter((t) => mismoId(t.clientId, filters?.clientId))),
    ),
    findById: jest.fn((id: number) =>
      Promise.resolve(almacen.find((t) => mismoId(t.id, id)) ?? null),
    ),
  };
  // Un timeline realista: el ciclo de vida mezclado con los eventos internos
  // (asignación, SLA, prioridad, marcadores de Jira) que el portal debe callar.
  const events = {
    listByTicket: jest.fn().mockResolvedValue([
      fullEvent(),
      fullEvent({ id: 101, type: 'TRIAGED', fromStatus: 'NUEVO', toStatus: 'TRIAJE' }),
      fullEvent({ id: 102, type: 'ASSIGNED' }),
      fullEvent({ id: 103, type: 'STATUS_CHANGED', fromStatus: 'TRIAJE', toStatus: 'ASIGNADO' }),
      fullEvent({ id: 104, type: 'TAKEN', fromStatus: 'ASIGNADO', toStatus: 'EN_ATENCION' }),
      fullEvent({ id: 105, type: 'SLA_AT_RISK' }),
      fullEvent({ id: 106, type: 'PRIORITY_OVERRIDDEN' }),
      fullEvent({ id: 107, type: 'COMMENT', payload: { action: 'JIRA_PUSHED', jiraIssueKey: 'KB-1' } }),
      fullEvent({ id: 108, type: 'ESCALATED', fromStatus: 'EN_ATENCION', toStatus: 'DERIVADO' }),
      fullEvent({ id: 109, type: 'RESOLVED', fromStatus: 'DERIVADO', toStatus: 'RESUELTO' }),
      fullEvent({ id: 110, type: 'REOPENED', fromStatus: 'RESUELTO', toStatus: 'EN_ATENCION' }),
      fullEvent({ id: 111, type: 'CLOSED', fromStatus: 'RESUELTO', toStatus: 'CERRADO' }),
    ]),
  };
  // `TicketsService.create` devuelve el ticket **y** el identificador del
  // primer mensaje de su hilo, que es de donde cuelgan los adjuntos del alta.
  const tickets = { create: jest.fn().mockResolvedValue({ ...ticket, firstMessageId: 700 }) };
  const systems = {
    listByClient: jest.fn().mockResolvedValue([
      { id: 5, clientId: 7, name: 'ERP', isActive: 1 },
      { id: 6, clientId: 7, name: 'Antiguo', isActive: 0 },
    ]),
  };

  const service = new PortalTicketsService(
    repo as any,
    events as any,
    tickets as any,
    systems as any,
  );
  return { service, repo, events, tickets, systems, ticket };
};

describe('la frontera', () => {
  it('la consulta siempre filtra por el clientId recibido', async () => {
    const { service, repo } = makeService();
    await service.list(7);
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ clientId: 7 }));
  });

  it('el listado no devuelve ni un ticket de otra empresa', async () => {
    const { service } = makeService();
    const vistos = await service.list(7);
    expect(vistos).toHaveLength(1);
    expect(vistos.map((t) => t.id)).not.toContain(999);
    expect(JSON.stringify(vistos)).not.toContain('otra empresa');
  });

  it('el listado del otro cliente tampoco ve los nuestros: el filtro va en los dos sentidos', async () => {
    const { service } = makeService();
    const vistos = await service.list(99);
    expect(vistos.map((t) => t.id)).toEqual([999]);
  });

  // El filtro del repositorio compartido falla *abierto*: `if (filters.clientId)`
  // deja caer el WHERE si el valor es falsy, y la consulta devolvería tickets de
  // todas las empresas. El portal no puede delegar su frontera en eso.
  it.each([
    ['cero', 0],
    ['indefinido', undefined],
    ['nulo', null],
    ['NaN', NaN],
    ['negativo', -1],
    ['decimal', 1.5],
  ])('list rechaza un clientId %s sin llegar a consultar', async (_etiqueta, valor) => {
    const { service, repo } = makeService();
    await expect(service.list(valor as any)).rejects.toThrow();
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('detail rechaza un clientId invalido sin llegar a consultar', async () => {
    const { service, repo } = makeService();
    await expect(service.detail(0, 1)).rejects.toThrow();
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('create rechaza un clientId invalido sin llegar a escribir', async () => {
    const { service, tickets } = makeService();
    await expect(
      service.create(11, 0, { subject: 'x', description: 'y' } as any),
    ).rejects.toThrow();
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('create rechaza un clientUserId invalido sin llegar a escribir', async () => {
    const { service, tickets } = makeService();
    await expect(
      service.create(0, 7, { subject: 'x', description: 'y' } as any),
    ).rejects.toThrow();
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('systems rechaza un clientId invalido sin llegar a consultar', async () => {
    const { service, systems } = makeService();
    await expect(service.systems(undefined as any)).rejects.toThrow();
    expect(systems.listByClient).not.toHaveBeenCalled();
  });

  it('el detalle de un ticket de otro cliente devuelve NOT_FOUND, no el ticket', async () => {
    const { service } = makeService({ id: 3, clientId: 99 });
    await expect(service.detail(7, 3)).rejects.toThrow(NotFoundException);
  });

  it('crear ignora cualquier clientId que venga en el cuerpo', async () => {
    const { service, tickets } = makeService();
    await service.create(11, 7, { subject: 'x', description: 'y', clientId: 99 } as any);
    expect(tickets.create).toHaveBeenCalledWith(
      { kind: 'CLIENT', clientUserId: 11 },
      expect.objectContaining({ clientId: 7 }),
    );
  });

  it('un ticket ajeno y uno inexistente dan exactamente el mismo error', async () => {
    const ajeno = makeService({ id: 3, clientId: 99 });
    const inexistente = makeService();
    inexistente.repo.findById.mockResolvedValue(null);

    const a = await ajeno.service.detail(7, 3).catch((e: any) => e.getResponse());
    const b = await inexistente.service.detail(7, 3).catch((e: any) => e.getResponse());
    expect(a).toEqual(b);
    expect(a).toEqual({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
  });

  it('los sistemas se piden siempre para el clientId recibido y solo devuelve los activos', async () => {
    const { service, systems } = makeService();
    const rows = await service.systems(7);
    expect(systems.listByClient).toHaveBeenCalledWith(7);
    expect(rows).toEqual([{ id: 5, name: 'ERP' }]);
  });

  it('crear rechaza un systemId que no es del cliente y no escribe nada', async () => {
    const { service, tickets } = makeService();
    await expect(
      service.create(11, 7, { subject: 'x', description: 'y', systemId: 999 } as any),
    ).rejects.toThrow(BadRequestException);
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('el detalle compara el cliente por valor, no por tipo (bigint llega como cadena)', async () => {
    const { service } = makeService({ id: 1, clientId: '7' });
    await expect(service.detail(7, 1)).resolves.toBeDefined();
  });

  /**
   * El cliente adjunta al crear el ticket, y esos archivos se suben **después**
   * del alta contra el primer mensaje del hilo. Sin este identificador en la
   * respuesta, la pantalla de subida no tiene de dónde colgarlos.
   */
  it('la respuesta del alta trae el identificador del primer mensaje', async () => {
    const { service } = makeService();
    const creado = await service.create(11, 7, { subject: 'x', description: 'y' } as any);
    expect(creado.firstMessageId).toBe(700);
  });

  /**
   * Y **solo** en la respuesta del alta: ni el listado ni el detalle lo
   * publican. La proyección del portal es una lista blanca escrita a mano, y
   * este campo solo sirve para colgar los adjuntos del alta que se acaba de
   * hacer -- en cualquier otra respuesta sería un identificador de más.
   */
  it('ni el listado ni el detalle publican el identificador del primer mensaje', async () => {
    const { service } = makeService();
    const listados = await service.list(7);
    const detalle = await service.detail(7, 1);
    expect(listados[0]).not.toHaveProperty('firstMessageId');
    expect(detalle).not.toHaveProperty('firstMessageId');
  });

  it('crear manda origin PORTAL y el texto del cliente como rawText', async () => {
    const { service, tickets } = makeService();
    await service.create(11, 7, { subject: 'Asunto', description: 'Detalle', systemId: 5 } as any);
    expect(tickets.create).toHaveBeenCalledWith(
      { kind: 'CLIENT', clientUserId: 11 },
      { clientId: 7, systemId: 5, subject: 'Asunto', rawText: 'Detalle', origin: 'PORTAL' },
    );
  });
});

/**
 * `sameId` es LA comprobacion de pertenencia que sostiene la regla del 404 del
 * portal. Se prueba directamente y no solo a traves del servicio: hoy el
 * segundo argumento siempre llega validado, pero la funcion no puede depender
 * de eso -- `Number(null)` es 0 y `Number(undefined)` es NaN, asi que un lado
 * sin guardar convierte un "no hay valor" en un id comparable.
 */
describe('sameId', () => {
  it('compara por valor: el bigint que llega como cadena es el mismo id', () => {
    expect(sameId('7', 7)).toBe(true);
    expect(sameId(7, '7')).toBe(true);
  });

  it('distingue ids distintos', () => {
    expect(sameId('7', 8)).toBe(false);
  });

  it.each([
    ['nulo', null],
    ['indefinido', undefined],
    ['cadena vacia', ''],
    ['no numerico', 'abc'],
  ])('un %s nunca es igual a nada, este en el primer argumento o en el segundo', (_e, valor) => {
    expect(sameId(valor, 0)).toBe(false);
    expect(sameId(0, valor)).toBe(false);
    expect(sameId(valor, 7)).toBe(false);
    expect(sameId(7, valor)).toBe(false);
    expect(sameId(valor, valor)).toBe(false);
  });

  it('es simetrica para cualquier par', () => {
    const valores = [null, undefined, '', 'abc', 0, '0', 7, '7', NaN, -1];
    for (const a of valores) {
      for (const b of valores) {
        expect(sameId(a, b)).toBe(sameId(b, a));
      }
    }
  });
});

describe('la proyeccion', () => {
  it('no expone prioridad, SLA ni asignado', async () => {
    const { service } = makeService();
    const [view] = await service.list(7);
    expect(view).not.toHaveProperty('priority');
    expect(view).not.toHaveProperty('slaResolutionDueAt');
    expect(view).not.toHaveProperty('slaAtRisk');
    expect(view).not.toHaveProperty('assigneeUserId');
  });

  it('los eventos del timeline no llevan reason ni actor', async () => {
    const { service } = makeService();
    const view = await service.detail(7, 1);
    view.timeline!.forEach((e) => {
      expect(e).not.toHaveProperty('reason');
      expect(e).not.toHaveProperty('actorUserId');
      expect(e).not.toHaveProperty('actorClientUserId');
    });
  });

  it('publica exactamente el conjunto de campos acordado, ni uno mas', async () => {
    const { service } = makeService();
    const [view] = await service.list(7);
    expect(Object.keys(view).sort()).toEqual(
      [
        'closedAt',
        'code',
        'createdAt',
        'descriptionMd',
        'id',
        'resolvedAt',
        'status',
        'subject',
        'systemId',
      ].sort(),
    );
  });

  it('el evento publica exactamente type, fromStatus, toStatus y createdAt', async () => {
    const { service } = makeService();
    const view = await service.detail(7, 1);
    expect(Object.keys(view.timeline![0]).sort()).toEqual(
      ['createdAt', 'fromStatus', 'toStatus', 'type'].sort(),
    );
    expect(view.timeline![0]).toEqual({
      type: 'CREATED',
      fromStatus: null,
      toStatus: 'NUEVO',
      createdAt: '2026-08-01T09:00:00.000Z',
    });
  });

  it('el timeline deja pasar el alta y los cambios de estado', async () => {
    const { service } = makeService();
    const view = await service.detail(7, 1);
    expect(view.timeline!.map((e) => e.type)).toEqual([
      'CREATED',
      'TRIAGED',
      'STATUS_CHANGED',
      'TAKEN',
      'ESCALATED',
      'RESOLVED',
      'REOPENED',
      'CLOSED',
    ]);
  });

  it('el timeline oculta SLA, prioridad, asignacion y los marcadores internos', async () => {
    const { service } = makeService();
    const view = await service.detail(7, 1);
    const tipos = view.timeline!.map((e) => e.type);
    ['SLA_AT_RISK', 'PRIORITY_OVERRIDDEN', 'ASSIGNED', 'COMMENT'].forEach((t) =>
      expect(tipos).not.toContain(t),
    );
  });

  it('un tipo de evento nuevo no se publica por omision: la lista es blanca, no negra', async () => {
    const { service, events } = makeService();
    events.listByTicket.mockResolvedValue([
      fullEvent(),
      fullEvent({ id: 200, type: 'COSTE_INTERNO_IMPUTADO', fromStatus: null, toStatus: null }),
    ]);
    const view = await service.detail(7, 1);
    expect(view.timeline!.map((e) => e.type)).toEqual(['CREATED']);
  });

  it('un ticket abierto en el portal muestra el texto que escribio el propio cliente', async () => {
    const { service } = makeService({
      origin: 'PORTAL',
      createdByClientUserId: 11,
      descriptionMd: null,
      rawText: 'Al guardar la guia sale error 500.',
    });
    const [view] = await service.list(7);
    expect(view.descriptionMd).toBe('Al guardar la guia sale error 500.');
  });

  it('un ticket interno sin descripcion elaborada NO filtra el texto crudo del equipo', async () => {
    const { service } = makeService({
      origin: 'NOTE',
      createdByClientUserId: null,
      createdBy: 1,
      descriptionMd: null,
      rawText: 'nota interna del equipo sobre este cliente',
    });
    const [view] = await service.list(7);
    expect(view.descriptionMd).toBeNull();
  });

  it('origin PORTAL sin autor de cliente tampoco basta: hacen falta las dos condiciones', async () => {
    const { service } = makeService({
      origin: 'PORTAL',
      createdByClientUserId: null,
      descriptionMd: null,
      rawText: 'texto que no escribio ningun cliente',
    });
    const [view] = await service.list(7);
    expect(view.descriptionMd).toBeNull();
  });

  it('la descripcion elaborada gana al texto crudo cuando existe', async () => {
    const { service } = makeService({
      origin: 'PORTAL',
      createdByClientUserId: 11,
      descriptionMd: 'Descripcion elaborada',
      rawText: 'texto crudo interno',
    });
    const [view] = await service.list(7);
    expect(view.descriptionMd).toBe('Descripcion elaborada');
  });

  it('no filtra el texto crudo, el payload ni los campos de Jira', async () => {
    const { service } = makeService();
    const view = await service.detail(7, 1);
    const raw = JSON.stringify(view);
    ['texto crudo interno', 'solucion interna', 'causa interna', 'jira', 'motivo interno'].forEach(
      (needle) => expect(raw.toLowerCase()).not.toContain(needle.toLowerCase()),
    );
  });

  it('normaliza fechas a ISO y los identificadores a numero', async () => {
    const { service } = makeService({ id: '3', systemId: '5' });
    const [view] = await service.list(7);
    expect(view.id).toBe(3);
    expect(view.systemId).toBe(5);
    expect(view.createdAt).toBe('2026-08-01T09:00:00.000Z');
    expect(view.resolvedAt).toBeNull();
  });
});

describe('el dto de alta', () => {
  const validar = async (dto: Record<string, unknown>) => {
    const instancia = plainToInstance(CreatePortalTicketDto, dto);
    const errores = await validate(instancia);
    return errores.map((e) => e.property);
  };

  const base = { subject: 'Asunto', description: 'Detalle' };

  it('acepta el alta minima', async () => {
    expect(await validar(base)).toEqual([]);
  });

  it('exige subject y description', async () => {
    expect((await validar({})).sort()).toEqual(['description', 'subject']);
  });

  // `raw_text` es TEXT utf8mb4: 65535 *bytes*, no caracteres. Un caracter puede
  // ocupar hasta 4, asi que 16383 es el mayor numero de caracteres que cabe
  // siempre (65532 bytes en el peor caso). Con MySQL en STRICT_TRANS_TABLES,
  // pasarse es un error 1406 -> un 500 al cliente en vez de un 400.
  it('acota description a lo que cabe de verdad en la columna', async () => {
    expect(await validar({ ...base, description: 'a'.repeat(16383) })).toEqual([]);
    expect(await validar({ ...base, description: 'a'.repeat(16384) })).toEqual(['description']);
  });

  it('acota subject a los 240 de su columna', async () => {
    expect(await validar({ ...base, subject: 'a'.repeat(240) })).toEqual([]);
    expect(await validar({ ...base, subject: 'a'.repeat(241) })).toEqual(['subject']);
  });
});
