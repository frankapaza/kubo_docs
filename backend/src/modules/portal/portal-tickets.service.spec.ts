import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PortalTicketsService } from './portal-tickets.service';

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

const makeService = (ticketOver: Record<string, unknown> = {}) => {
  const ticket = fullTicket(ticketOver);
  const repo = {
    list: jest.fn().mockResolvedValue([ticket]),
    findById: jest.fn().mockResolvedValue(ticket),
  };
  const events = {
    listByTicket: jest.fn().mockResolvedValue([fullEvent(), fullEvent({ id: 101, type: 'TRIAGED', fromStatus: 'NUEVO', toStatus: 'TRIAJE' })]),
  };
  const tickets = { create: jest.fn().mockResolvedValue(ticket) };
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

  it('crear manda origin PORTAL y el texto del cliente como rawText', async () => {
    const { service, tickets } = makeService();
    await service.create(11, 7, { subject: 'Asunto', description: 'Detalle', systemId: 5 } as any);
    expect(tickets.create).toHaveBeenCalledWith(
      { kind: 'CLIENT', clientUserId: 11 },
      { clientId: 7, systemId: 5, subject: 'Asunto', rawText: 'Detalle', origin: 'PORTAL' },
    );
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
