import { ConflictException, NotFoundException } from '@nestjs/common';

import { DevApiService } from './dev-api.service';
import { DevPrincipal } from './dev-keys.service';

const P: DevPrincipal = {
  keyId: 5,
  userId: 9,
  userName: 'Ana Dev',
  repoId: 3,
  repoFullName: 'cobrosseguros/cobranza',
  clientSystemId: 11,
  clientId: 4,
  clientName: 'Cobros Seguros',
  systemName: 'Cobranza',
};

const TICKET = {
  id: 100, code: 'KB-0210', systemId: 11, clientId: 4, status: 'ASIGNADO', priority: 'P2',
  assigneeUserId: 9, subject: 'Filtro de fecha', rawText: 'El reporte no filtra', descriptionMd: null,
  acceptanceCriteria: ['filtra por fecha'], moduleName: 'Pagos', screenName: 'Reporte', requestType: 'BUG',
  slaResolutionDueAt: null, archivedAt: null,
};

const RQ = {
  id: 200, code: 'RQ-0045', clientId: 4, clientSystemId: 11, status: 'PENDIENTE', priority: 'ALTA',
  assigneeUserId: 9, title: 'Exportar a Excel', descriptionMd: 'detalle', acceptanceCriteria: null, dueDate: null,
};

function build(over: { ticket?: object | null; rq?: object | null; open?: object[] } = {}) {
  const data = {
    findTicketByCode: jest.fn().mockResolvedValue(over.ticket === undefined ? TICKET : over.ticket),
    findWorkItemByCode: jest.fn().mockResolvedValue(over.rq === undefined ? RQ : over.rq),
    listOpenItems: jest.fn().mockResolvedValue(over.open ?? []),
    listLinks: jest.fn().mockResolvedValue([]),
    upsertLink: jest.fn().mockResolvedValue(undefined),
  };
  const messages = {
    post: jest.fn().mockResolvedValue({ message: { id: 1 } }),
    listThread: jest.fn().mockResolvedValue([]),
  };
  const attachments = { list: jest.fn().mockResolvedValue([]) };
  const transitions = { transition: jest.fn().mockResolvedValue({ ...TICKET, status: 'EN_ATENCION' }) };
  const board = { move: jest.fn().mockResolvedValue({ ...RQ, status: 'EN_PROCESO' }) };
  const wiEvents = {
    record: jest.fn().mockResolvedValue({ id: 1 }),
    listByItem: jest.fn().mockResolvedValue([]),
  };
  const service = new DevApiService(
    data as never, messages as never, attachments as never, transitions as never, board as never, wiEvents as never,
  );
  return { service, data, messages, transitions, board, wiEvents };
}

describe('DevApiService', () => {
  it('un ticket de otra asignación responde 404', async () => {
    const { service } = build({ ticket: { ...TICKET, systemId: 99 } });
    await expect(service.item(P, 'KB-0210')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un RQ sin sistema responde 404', async () => {
    const { service } = build({ rq: { ...RQ, clientSystemId: null } });
    await expect(service.item(P, 'RQ-0045')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un código mal formado responde 404 sin consultar', async () => {
    const { service, data } = build();
    await expect(service.item(P, 'hola')).rejects.toBeInstanceOf(NotFoundException);
    expect(data.findTicketByCode).not.toHaveBeenCalled();
  });

  it('normaliza el código antes de buscar', async () => {
    const { service, data } = build();
    await service.item(P, ' kb-0210 ');
    expect(data.findTicketByCode).toHaveBeenCalledWith('KB-0210');
  });

  it('el detalle de un ticket trae módulo y pantalla; el de un RQ no', async () => {
    const { service } = build();
    const t = await service.item(P, 'KB-0210');
    expect(t).toMatchObject({ tipo: 'TICKET', modulo: 'Pagos', pantalla: 'Reporte', esMio: true });
    const r = await service.item(P, 'RQ-0045');
    expect(r.tipo).toBe('REQUERIMIENTO');
    expect(r).not.toHaveProperty('modulo');
  });

  it('estado fuera de la lista blanca responde 409 y no toca el ticket', async () => {
    const { service, transitions } = build({ ticket: { ...TICKET, status: 'EN_ATENCION' } });
    await expect(service.estado(P, 'KB-0210', 'RESUELTO')).rejects.toBeInstanceOf(ConflictException);
    expect(transitions.transition).not.toHaveBeenCalled();
  });

  it('un ítem no asignado al dueño de la clave responde 409', async () => {
    const t = build({ ticket: { ...TICKET, assigneeUserId: 77 } });
    await expect(t.service.estado(P, 'KB-0210', 'EN_ATENCION')).rejects.toBeInstanceOf(ConflictException);
    const r = build({ rq: { ...RQ, assigneeUserId: null } });
    await expect(r.service.estado(P, 'RQ-0045', 'EN_PROCESO')).rejects.toBeInstanceOf(ConflictException);
    expect(r.board.move).not.toHaveBeenCalled();
  });

  it('mueve un ticket propio por el servicio de transiciones', async () => {
    const { service, transitions } = build();
    await service.estado(P, 'KB-0210', 'en_atencion');
    expect(transitions.transition).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 100, actorUserId: 9, toStatus: 'EN_ATENCION' }),
    );
  });

  it('mueve un RQ propio por el tablero, al principio de la columna', async () => {
    const { service, board } = build();
    await service.estado(P, 'RQ-0045', 'EN_PROCESO');
    expect(board.move).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: 200, actorUserId: 9, toStatus: 'EN_PROCESO', toIndex: 0 }),
    );
  });

  it('la nota de un ticket es INTERNA y con autor el dueño de la clave', async () => {
    const { service, messages } = build({ ticket: { ...TICKET, assigneeUserId: 77 } });
    await service.nota(P, 'KB-0210', '  Corregido el filtro  ');
    expect(messages.post).toHaveBeenCalledWith(
      { kind: 'STAFF', userId: 9 },
      100,
      expect.objectContaining({ visibility: 'INTERNA', bodyMd: expect.stringContaining('Corregido el filtro') }),
    );
  });

  it('la nota de un RQ es un evento COMMENT marcado via claude', async () => {
    const { service, wiEvents } = build();
    await service.nota(P, 'RQ-0045', 'Avance');
    expect(wiEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: 200, type: 'COMMENT', actorUserId: 9, reason: 'Avance', payload: { via: 'claude' } }),
    );
  });

  it('pendientes: míos primero, luego prioridad, y como mucho 50', async () => {
    const open = [
      { tipo: 'TICKET', codigo: 'KB-0001', prioridad: 'P1', assigneeUserId: 77, vence: null },
      { tipo: 'REQUERIMIENTO', codigo: 'RQ-0002', prioridad: 'BAJA', assigneeUserId: 9, vence: null },
      { tipo: 'TICKET', codigo: 'KB-0003', prioridad: 'P2', assigneeUserId: 9, vence: null },
      ...Array.from({ length: 60 }, (_, i) => ({
        tipo: 'TICKET', codigo: `KB-${1000 + i}`, prioridad: 'P4', assigneeUserId: null, vence: null,
      })),
    ];
    const { service } = build({ open });
    const out = await service.pendientes(P);
    expect(out.items).toHaveLength(50);
    expect(out.total).toBe(63);
    expect(out.items.slice(0, 3).map((i) => i.codigo)).toEqual(['KB-0003', 'RQ-0002', 'KB-0001']);
    expect(out.items[0].esMio).toBe(true);
  });

  it('vincular registra un link MCP en el ítem del alcance', async () => {
    const { service, data } = build();
    await service.vincular(P, 'KB-0210', { kind: 'COMMIT', ref: 'abc123', title: 'KB-0210 fix' });
    expect(data.upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({ devRepoId: 3, ticketId: 100, workItemId: null, kind: 'COMMIT', ref: 'abc123', source: 'MCP' }),
    );
  });
});
