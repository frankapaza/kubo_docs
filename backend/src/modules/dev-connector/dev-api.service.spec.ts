import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';

import { BORRADOR_CABECERA, DevApiService } from './dev-api.service';
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

function build(
  over: { ticket?: object | null; rq?: object | null; open?: object[]; files?: object[]; docs?: object[]; docBuffer?: Buffer } = {},
) {
  const data = {
    findTicketByCode: jest.fn().mockResolvedValue(over.ticket === undefined ? TICKET : over.ticket),
    findWorkItemByCode: jest.fn().mockResolvedValue(over.rq === undefined ? RQ : over.rq),
    listOpenItems: jest.fn().mockResolvedValue(over.open ?? []),
    listLinks: jest.fn().mockResolvedValue([]),
    upsertLink: jest.fn().mockResolvedValue(undefined),
    listActiveStaff: jest.fn().mockResolvedValue([
      { id: 9, email: 'ana@kubo.pe', fullName: 'Ana Dev' },
      { id: 12, email: 'luis@kubo.pe', fullName: 'Luis Gómez' },
    ]),
  };
  const messages = {
    post: jest.fn().mockResolvedValue({ message: { id: 1 } }),
    listThread: jest.fn().mockResolvedValue([]),
  };
  const attachments = {
    list: jest.fn().mockResolvedValue(over.files ?? []),
    download: jest.fn().mockImplementation(async () => ({
      stream: Readable.from([Buffer.from('PNGDATA')]), filename: 'captura.png', mimeType: 'image/png', size: 7,
    })),
  };
  const transitions = { transition: jest.fn().mockResolvedValue({ ...TICKET, status: 'EN_ATENCION' }) };
  const board = {
    move: jest.fn().mockImplementation(async (i: { toStatus: string }) => ({ ...RQ, status: i.toStatus })),
    assign: jest.fn().mockResolvedValue({ ...RQ, assigneeUserId: 9 }),
  };
  const docs = {
    list: jest.fn().mockResolvedValue(over.docs ?? []),
    readBuffer: jest.fn().mockImplementation(async (_w: number, id: number) => ({
      doc: (over.docs ?? []).find((d) => (d as { id: number }).id === id),
      buffer: over.docBuffer ?? Buffer.from('%PDF-1.7'),
    })),
    renderManualPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-manual')),
    upload: jest.fn().mockResolvedValue({ id: 31 }),
  };
  const wiEvents = {
    record: jest.fn().mockResolvedValue({ id: 1 }),
    listByItem: jest.fn().mockResolvedValue([]),
  };
  const assignment = {
    assign: jest.fn().mockResolvedValue({ ...TICKET, status: 'ASIGNADO' }),
    take: jest.fn().mockResolvedValue({ ...TICKET, status: 'EN_ATENCION' }),
  };
  const ticketEvents = { record: jest.fn().mockResolvedValue({ id: 1 }) };
  const service = new DevApiService(
    data as never, messages as never, attachments as never, transitions as never, board as never, wiEvents as never,
    assignment as never, docs as never, ticketEvents as never, { sensitiveActionsEnabled: true },
  );
  return { service, data, messages, attachments, transitions, board, wiEvents, assignment, docs, ticketEvents };
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

describe('vincular desde el MCP no pisa el estado de un PR', () => {
  it('manda state null para que el upsert conserve merged/closed del webhook', async () => {
    const { service, data } = build();
    await service.vincular(P, 'KB-0210', { kind: 'PR', ref: '12' });
    expect(data.upsertLink).toHaveBeenCalledWith(expect.objectContaining({ kind: 'PR', state: null }));
  });
});

describe('adjuntos', () => {
  const FILE = { id: 77, messageId: 1, filename: 'captura.png', mimeType: 'image/png', size: 7, createdAt: new Date() };

  it('el detalle lista cada adjunto con su id y su tipo', async () => {
    const { service } = build({ files: [FILE] });
    const t = await service.item(P, 'KB-0210');
    expect(t.adjuntos).toEqual([{ id: 77, nombre: 'captura.png', tipo: 'image/png', tamanoBytes: 7 }]);
  });

  it('devuelve el contenido en base64 de un adjunto del ticket', async () => {
    const { service, attachments } = build({ files: [FILE] });
    const out = await service.adjunto(P, 'KB-0210', 77);
    expect(attachments.download).toHaveBeenCalledWith({ kind: 'STAFF', userId: 9 }, 77);
    expect(out).toEqual({
      id: 77, nombre: 'captura.png', tipo: 'image/png', tamanoBytes: 7, base64: Buffer.from('PNGDATA').toString('base64'),
    });
  });

  it('un adjunto que no es de ese ticket responde 404 sin descargar', async () => {
    const { service, attachments } = build({ files: [FILE] });
    await expect(service.adjunto(P, 'KB-0210', 78)).rejects.toBeInstanceOf(NotFoundException);
    expect(attachments.download).not.toHaveBeenCalled();
  });

  it('un ticket de otra asignación responde 404', async () => {
    const { service, attachments } = build({ ticket: { ...TICKET, systemId: 99 }, files: [FILE] });
    await expect(service.adjunto(P, 'KB-0210', 77)).rejects.toBeInstanceOf(NotFoundException);
    expect(attachments.download).not.toHaveBeenCalled();
  });

  it('más de 5 MB responde 400 y no lo lee', async () => {
    const { service, attachments } = build({ files: [{ ...FILE, size: 6 * 1024 * 1024 }] });
    await expect(service.adjunto(P, 'KB-0210', 77)).rejects.toBeInstanceOf(BadRequestException);
    expect(attachments.download).not.toHaveBeenCalled();
  });
});

describe('tomar', () => {
  it('un ticket NUEVO sin asignar: se lo asigna al dueño de la clave y lo pone en atención', async () => {
    const { service, assignment } = build({ ticket: { ...TICKET, status: 'NUEVO', assigneeUserId: null } });
    const out = await service.tomar(P, 'KB-0210');
    expect(assignment.assign).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 100, actorUserId: 9, assigneeUserId: 9 }),
    );
    expect(assignment.take).toHaveBeenCalledWith({ ticketId: 100, actorUserId: 9 });
    expect(out).toEqual({ codigo: 'KB-0210', estado: 'EN_ATENCION' });
  });

  it('un ticket ASIGNADO a mí: solo lo pone en atención', async () => {
    const { service, assignment } = build({ ticket: { ...TICKET, status: 'ASIGNADO', assigneeUserId: 9 } });
    await service.tomar(P, 'KB-0210');
    expect(assignment.assign).not.toHaveBeenCalled();
    expect(assignment.take).toHaveBeenCalled();
  });

  it('ya en atención y mío: no hace nada', async () => {
    const { service, assignment } = build({ ticket: { ...TICKET, status: 'EN_ATENCION', assigneeUserId: 9 } });
    const out = await service.tomar(P, 'KB-0210');
    expect(assignment.take).not.toHaveBeenCalled();
    expect(out.estado).toBe('EN_ATENCION');
  });

  it('asignado a otra persona: 409 sin tocarlo', async () => {
    const { service, assignment } = build({ ticket: { ...TICKET, status: 'ASIGNADO', assigneeUserId: 77 } });
    await expect(service.tomar(P, 'KB-0210')).rejects.toBeInstanceOf(ConflictException);
    expect(assignment.assign).not.toHaveBeenCalled();
    expect(assignment.take).not.toHaveBeenCalled();
  });

  it('resuelto o cerrado: 409', async () => {
    const { service } = build({ ticket: { ...TICKET, status: 'CERRADO', assigneeUserId: null } });
    await expect(service.tomar(P, 'KB-0210')).rejects.toBeInstanceOf(ConflictException);
  });

});

describe('resolver', () => {
  const EVIDENCIA = { solucion: 'Se partió la sincronización en lotes', causaRaiz: 'Timeout de Cloudflare a los 100 s', accionCorrectiva: 'Job en segundo plano' };

  it('resuelve un ticket mío en atención con la evidencia y marca que fue vía Claude', async () => {
    const { service, transitions } = build({ ticket: { ...TICKET, status: 'EN_ATENCION', assigneeUserId: 9 } });
    transitions.transition.mockResolvedValueOnce({ ...TICKET, status: 'RESUELTO' });
    const out = await service.resolver(P, 'KB-0210', EVIDENCIA);
    const arg = transitions.transition.mock.calls[0][0];
    expect(arg).toMatchObject({ ticketId: 100, actorUserId: 9, toStatus: 'RESUELTO', rootCause: EVIDENCIA.causaRaiz, correctiveAction: EVIDENCIA.accionCorrectiva });
    expect(arg.resolutionMd).toContain(EVIDENCIA.solucion);
    expect(arg.resolutionMd).toContain('vía Claude');
    expect(out).toEqual({ codigo: 'KB-0210', estado: 'RESUELTO' });
  });

  it('sin alguno de los tres campos: 400 sin tocarlo', async () => {
    const { service, transitions } = build({ ticket: { ...TICKET, status: 'EN_ATENCION', assigneeUserId: 9 } });
    await expect(service.resolver(P, 'KB-0210', { ...EVIDENCIA, causaRaiz: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(transitions.transition).not.toHaveBeenCalled();
  });

  it('no asignado a mí: 409', async () => {
    const { service } = build({ ticket: { ...TICKET, status: 'EN_ATENCION', assigneeUserId: 77 } });
    await expect(service.resolver(P, 'KB-0210', EVIDENCIA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('solo desde EN_ATENCION o ESPERA_CLIENTE: 409 en otro estado', async () => {
    const { service } = build({ ticket: { ...TICKET, status: 'ASIGNADO', assigneeUserId: 9 } });
    await expect(service.resolver(P, 'KB-0210', EVIDENCIA)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('borrador de respuesta', () => {
  it('queda como nota INTERNA marcada como borrador, nunca pública', async () => {
    const { service, messages } = build();
    await service.borrador(P, 'KB-0210', 'Hola, ya está corregido.');
    const [, ticketId, body] = messages.post.mock.calls[0];
    expect(ticketId).toBe(100);
    expect(body.visibility).toBe('INTERNA');
    expect(body.bodyMd.startsWith(BORRADOR_CABECERA)).toBe(true);
    expect(body.bodyMd).toContain('Hola, ya está corregido.');
  });

  it('vacío: 400', async () => {
    const { service, messages } = build();
    await expect(service.borrador(P, 'KB-0210', '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(messages.post).not.toHaveBeenCalled();
  });

  it('un ticket cerrado no admite borradores: 409', async () => {
    const { service } = build({ ticket: { ...TICKET, status: 'CERRADO' } });
    await expect(service.borrador(P, 'KB-0210', 'x')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('requerimientos: documentos', () => {
  const ESPEC = {
    id: 41, kind: 'ESPECIFICACION', kindLabel: 'Especificación del requerimiento', status: 'VIGENTE',
    filename: 'espec.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 900,
  };

  it('el detalle de un RQ lista sus documentos con tipo y estado', async () => {
    const { service } = build({ docs: [ESPEC] });
    const r = await service.item(P, 'RQ-0045');
    expect(r.adjuntos).toEqual([
      {
        id: 41, nombre: 'espec.docx', tipo: ESPEC.mimeType, tamanoBytes: 900,
        documento: 'Especificación del requerimiento', estado: 'VIGENTE',
      },
    ]);
  });

  it('ver un PDF de un RQ devuelve su base64', async () => {
    const { service, docs } = build({ docs: [{ ...ESPEC, filename: 'espec.pdf', mimeType: 'application/pdf' }] });
    const out = await service.adjunto(P, 'RQ-0045', 41);
    expect(docs.readBuffer).toHaveBeenCalledWith(200, 41);
    expect(out.base64).toBe(Buffer.from('%PDF-1.7').toString('base64'));
    expect(out.texto).toBeUndefined();
  });

  it('un documento que no es de ese RQ responde 404 sin leerlo', async () => {
    const { service, docs } = build({ docs: [ESPEC] });
    await expect(service.adjunto(P, 'RQ-0045', 99)).rejects.toBeInstanceOf(NotFoundException);
    expect(docs.readBuffer).not.toHaveBeenCalled();
  });

  it('un documento de más de 5 MB responde 400 sin leerlo', async () => {
    const { service, docs } = build({ docs: [{ ...ESPEC, sizeBytes: 6 * 1024 * 1024 }] });
    await expect(service.adjunto(P, 'RQ-0045', 41)).rejects.toBeInstanceOf(BadRequestException);
    expect(docs.readBuffer).not.toHaveBeenCalled();
  });
});

describe('tomar un requerimiento', () => {
  it('libre y PENDIENTE: se lo asigna y lo pasa a EN_PROCESO', async () => {
    const { service, board } = build({ rq: { ...RQ, assigneeUserId: null } });
    const out = await service.tomar(P, 'RQ-0045');
    expect(board.assign).toHaveBeenCalledWith({ workItemId: 200, actorUserId: 9, assigneeUserId: 9 });
    expect(board.move).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: 200, actorUserId: 9, toStatus: 'EN_PROCESO', toIndex: 0 }),
    );
    expect(out).toMatchObject({ codigo: 'RQ-0045', estado: 'EN_PROCESO' });
  });

  it('avisa si no tiene Especificación vigente', async () => {
    const sin = await build().service.tomar(P, 'RQ-0045');
    expect(sin.aviso).toMatch(/Especificación/);
    const con = await build({ docs: [{ id: 1, kind: 'ESPECIFICACION', status: 'VIGENTE' }] }).service.tomar(P, 'RQ-0045');
    expect(con.aviso).toBeUndefined();
  });

  it('ya EN_PROCESO y mío: no lo toca', async () => {
    const { service, board } = build({ rq: { ...RQ, status: 'EN_PROCESO' } });
    const out = await service.tomar(P, 'RQ-0045');
    expect(board.assign).not.toHaveBeenCalled();
    expect(board.move).not.toHaveBeenCalled();
    expect(out.estado).toBe('EN_PROCESO');
  });

  it('de otra persona: 409 sin tocarlo', async () => {
    const { service, board } = build({ rq: { ...RQ, assigneeUserId: 77 } });
    await expect(service.tomar(P, 'RQ-0045')).rejects.toBeInstanceOf(ConflictException);
    expect(board.assign).not.toHaveBeenCalled();
  });

  it('SOLICITADO (sin aceptar): 409, la aceptación es de una persona', async () => {
    const { service, board } = build({ rq: { ...RQ, status: 'SOLICITADO', assigneeUserId: null } });
    await expect(service.tomar(P, 'RQ-0045')).rejects.toThrow(/acept/i);
    expect(board.assign).not.toHaveBeenCalled();
  });

  it('en PRUEBAS o CERRADO: 409', async () => {
    const { service } = build({ rq: { ...RQ, status: 'PRUEBAS' } });
    await expect(service.tomar(P, 'RQ-0045')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('entregar un requerimiento', () => {
  const E = { solucion: 'Botón Exportar en Pagos (PR #12)', comoProbar: 'Pagos → Exportar', manual: '# Exportar\n\n1. Abre Pagos' };

  it('genera el manual en PDF como borrador, deja la evidencia y lo pasa a PRUEBAS', async () => {
    const { service, docs, wiEvents, board } = build({ rq: { ...RQ, status: 'EN_PROCESO' } });
    const out = await service.entregar(P, 'RQ-0045', E);
    expect(docs.renderManualPdf).toHaveBeenCalledWith(expect.stringContaining('RQ-0045'), E.manual);
    expect(docs.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 200, actorUserId: 9, kind: 'MANUAL_USUARIO', status: 'BORRADOR', source: 'CLAUDE',
        filename: 'RQ-0045 - Manual de usuario.pdf',
      }),
    );
    expect(wiEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 200, type: 'COMMENT', reason: expect.stringContaining('Pagos → Exportar'),
      }),
    );
    expect(board.move).toHaveBeenCalledWith(expect.objectContaining({ toStatus: 'PRUEBAS' }));
    expect(out).toEqual({ codigo: 'RQ-0045', estado: 'PRUEBAS', manualId: 31 });
  });

  it('sin evidencia o sin manual: 400 y no toca nada', async () => {
    const { service, board, docs } = build({ rq: { ...RQ, status: 'EN_PROCESO' } });
    await expect(service.entregar(P, 'RQ-0045', { ...E, manual: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.entregar(P, 'RQ-0045', { ...E, comoProbar: '' })).rejects.toBeInstanceOf(BadRequestException);
    expect(docs.upload).not.toHaveBeenCalled();
    expect(board.move).not.toHaveBeenCalled();
  });

  it('no es mío o no está EN_PROCESO: 409', async () => {
    const otro = build({ rq: { ...RQ, status: 'EN_PROCESO', assigneeUserId: 77 } });
    await expect(otro.service.entregar(P, 'RQ-0045', E)).rejects.toBeInstanceOf(ConflictException);
    const pendiente = build({ rq: { ...RQ, status: 'PENDIENTE' } });
    await expect(pendiente.service.entregar(P, 'RQ-0045', E)).rejects.toBeInstanceOf(ConflictException);
    expect(pendiente.docs.upload).not.toHaveBeenCalled();
  });

  it('un ticket no se entrega: 400 (se resuelve)', async () => {
    const { service } = build();
    await expect(service.entregar(P, 'KB-0210', E)).rejects.toBeInstanceOf(BadRequestException);
  });
});


describe('DevApiService: acciones confirmadas (estado, asignar, responder)', () => {
  const MIO_EN_ATENCION = { ...TICKET, status: 'EN_ATENCION', assigneeUserId: 9 };

  it('pasar a Espera del cliente exige motivo y lo envía a la transición', async () => {
    const { service, transitions } = build({ ticket: MIO_EN_ATENCION });
    await expect(service.estado(P, 'KB-0210', 'ESPERA_CLIENTE')).rejects.toBeInstanceOf(BadRequestException);
    await service.estado(P, 'KB-0210', 'ESPERA_CLIENTE', 'Falta el archivo de prueba');
    expect(transitions.transition).toHaveBeenCalledWith(expect.objectContaining({ toStatus: 'ESPERA_CLIENTE', reason: 'Falta el archivo de prueba', actorUserId: 9 }));
  });

  it('asignar a otra persona por correo pasa por el servicio de asignación', async () => {
    const { service, assignment } = build({ ticket: { ...TICKET, status: 'NUEVO', assigneeUserId: null } });
    const r = await service.asignar(P, 'KB-0210', 'luis@kubo.pe');
    expect(assignment.assign).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 100, actorUserId: 9, assigneeUserId: 12 }));
    expect(r).toMatchObject({ codigo: 'KB-0210', asignadoA: 'Luis Gómez' });
  });

  it('asignar a alguien que no existe -> 400 con la lista de válidos; un ticket cerrado -> 409', async () => {
    const a = build({ ticket: { ...TICKET, status: 'NUEVO' } });
    await expect(a.service.asignar(P, 'KB-0210', 'pedro')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BAD_INPUT', message: expect.stringContaining('luis@kubo.pe') }) });
    const b = build({ ticket: { ...TICKET, status: 'CERRADO' } });
    await expect(b.service.asignar(P, 'KB-0210', 'luis@kubo.pe')).rejects.toBeInstanceOf(ConflictException);
    expect(b.assignment.assign).not.toHaveBeenCalled();
  });

  it('responder: mensaje PÚBLICO del dueño de la clave, solo en tickets propios', async () => {
    const { service, messages } = build({ ticket: MIO_EN_ATENCION });
    await service.responder(P, 'KB-0210', 'Ya quedó corregido.');
    expect(messages.post).toHaveBeenCalledWith({ kind: 'STAFF', userId: 9 }, 100, { bodyMd: 'Ya quedó corregido.', visibility: 'PUBLICA' });
  });

  it('responder sobre un ticket ajeno -> 409 sin enviar nada; vacío -> 400; cerrado -> 409', async () => {
    const ajeno = build({ ticket: { ...MIO_EN_ATENCION, assigneeUserId: 33 } });
    await expect(ajeno.service.responder(P, 'KB-0210', 'hola')).rejects.toBeInstanceOf(ConflictException);
    expect(ajeno.messages.post).not.toHaveBeenCalled();
    const vacio = build({ ticket: MIO_EN_ATENCION });
    await expect(vacio.service.responder(P, 'KB-0210', '   ')).rejects.toBeInstanceOf(BadRequestException);
    const cerrado = build({ ticket: { ...MIO_EN_ATENCION, status: 'CERRADO' } });
    await expect(cerrado.service.responder(P, 'KB-0210', 'hola')).rejects.toBeInstanceOf(ConflictException);
  });
});


describe('DevApiService: revisión final (marca, persona resuelta, interruptor)', () => {
  const MIO = { ...TICKET, status: 'EN_ATENCION', assigneeUserId: 9 };

  it('responder deja en el historial que lo envió el conector (via claude, repo y mensaje)', async () => {
    const { service, ticketEvents } = build({ ticket: MIO });
    await service.responder(P, 'KB-0210', 'Listo');
    expect(ticketEvents.record).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 100, type: 'COMMENT', actorUserId: 9,
      payload: expect.objectContaining({ via: 'claude', repo: 'cobrosseguros/cobranza', accion: 'RESPUESTA_CLIENTE', messageId: 1 }),
    }));
  });

  it('persona(): resuelve quién sería, o explica por qué no', async () => {
    const { service } = build();
    await expect(service.persona('gomez')).resolves.toEqual({ ok: true, nombre: 'Luis Gómez', correo: 'luis@kubo.pe' });
    await expect(service.persona('pedro')).resolves.toMatchObject({ ok: false, motivo: expect.stringContaining('luis@kubo.pe') });
  });

  it('con el interruptor apagado, responder, asignar y pasar a espera/derivado -> 403 sin hacer nada', async () => {
    const t = build({ ticket: MIO });
    const off = new DevApiService(
      t.data as never, t.messages as never, t.attachments as never, t.transitions as never, t.board as never, t.wiEvents as never,
      t.assignment as never, t.docs as never, t.ticketEvents as never, { sensitiveActionsEnabled: false },
    );
    for (const call of [
      () => off.responder(P, 'KB-0210', 'hola'),
      () => off.asignar(P, 'KB-0210', 'luis@kubo.pe'),
      () => off.estado(P, 'KB-0210', 'ESPERA_CLIENTE', 'motivo'),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 403, response: expect.objectContaining({ code: 'ACCION_DESHABILITADA' }) });
    }
    expect(t.messages.post).not.toHaveBeenCalled();
    expect(t.assignment.assign).not.toHaveBeenCalled();
    expect(t.transitions.transition).not.toHaveBeenCalled();
    // Lo de siempre sigue funcionando.
    await expect(off.estado(P, 'RQ-0045', 'EN_PROCESO')).resolves.toBeDefined();
  });
});
