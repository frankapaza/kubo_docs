import { ConflictException } from '@nestjs/common';
import { Subject } from 'rxjs';

import { WorkItemConformityService } from './work-item-conformity.service';

const RQ = {
  id: 200, code: 'RQ-0045', title: 'Exportar pagos', clientId: 4, clientSystemId: 11, status: 'PRUEBAS',
  acceptanceCriteria: ['Exporta el mes'], dueDate: '2026-12-01', conformityDocumentId: null, createdBy: 3,
};

const FIRMANTE = { signerName: 'Ana Pérez', signerEmail: 'ana@cliente.pe', signerRole: 'Jefa de Cobranza' };

function build(over: { rq?: object; sigs?: object[]; doc?: object; emailFails?: boolean } = {}) {
  const rq = { ...RQ, ...(over.rq ?? {}) };
  const signed$ = new Subject<{ documentId: number }>();
  const items = {
    findOneBy: jest.fn().mockImplementation(async (w: { id?: number; conformityDocumentId?: number }) =>
      (w.id === rq.id || (w.conformityDocumentId != null && w.conformityDocumentId === rq.conformityDocumentId) ? rq : null),
    ),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const docOrm = {
    findOneBy: jest.fn().mockResolvedValue({ id: 90, title: 'Acta', status: 'SENT', createdBy: 3, createdAt: new Date(), ...(over.doc ?? {}) }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const data = { query: jest.fn().mockImplementation(async (sql: string) => (sql.includes('systems') ? [{ name: 'Cobranza' }] : [])) };
  const clients = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 4, razonSocial: 'Gestora Fidelity' }) };
  const docs = {
    list: jest.fn().mockResolvedValue([{ kind: 'MANUAL_USUARIO', status: 'VIGENTE', filename: 'RQ-0045 - Manual.pdf' }]),
    upload: jest.fn().mockResolvedValue({ id: 51 }),
  };
  const events = { record: jest.fn().mockResolvedValue({ id: 1 }) };
  const board = { move: jest.fn().mockResolvedValue({ ...rq, status: 'CERRADO' }) };
  const documents = {
    createDocumentRaw: jest.fn().mockResolvedValue({ id: 90, title: 'Acta', status: 'DRAFT' }),
    getPdfBuffer: jest.fn().mockResolvedValue(Buffer.from('%PDF-acta')),
  };
  const signatories = {
    signed$,
    create: jest.fn().mockResolvedValue({ id: 70 }),
    list: jest.fn().mockResolvedValue(over.sigs ?? []),
    requestSignature: over.emailFails
      ? jest.fn().mockRejectedValue(new Error('SMTP caído'))
      : jest.fn().mockResolvedValue({ id: 70 }),
  };
  const service = new WorkItemConformityService(
    items as never, docOrm as never, data as never, clients as never, docs as never, events as never,
    board as never, documents as never, signatories as never,
  );
  return { service, rq, items, docOrm, docs, events, board, documents, signatories, signed$ };
}

describe('WorkItemConformityService.create', () => {
  it('genera el acta, la enlaza al RQ, agrega al firmante y le envía el enlace', async () => {
    const { service, documents, items, signatories, events } = build();
    const out = await service.create(200, 9, FIRMANTE);
    const [, input] = documents.createDocumentRaw.mock.calls[0];
    expect(input).toMatchObject({ clientId: 4, type: 'ACTA_CONFORMIDAD', title: expect.stringContaining('RQ-0045') });
    expect(input.contentMarkdown).toContain('Gestora Fidelity');
    expect(input.contentMarkdown).toContain('Cobranza');
    expect(input.contentMarkdown).toContain('RQ-0045 - Manual.pdf');
    expect(items.update).toHaveBeenCalledWith({ id: 200 }, { conformityDocumentId: 90 });
    expect(signatories.create).toHaveBeenCalledWith(
      90, expect.objectContaining({ kind: 'EXTERNAL', fullName: 'Ana Pérez', email: 'ana@cliente.pe' }),
    );
    expect(signatories.requestSignature).toHaveBeenCalledWith(70);
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ workItemId: 200, type: 'COMMENT' }));
    expect(out.emailError).toBeUndefined();
  });

  it('solo desde PRUEBAS', async () => {
    const { service, documents } = build({ rq: { status: 'EN_PROCESO' } });
    await expect(service.create(200, 9, FIRMANTE)).rejects.toBeInstanceOf(ConflictException);
    expect(documents.createDocumentRaw).not.toHaveBeenCalled();
  });

  it('si ya hay un acta vigente: 409 (se reenvía, no se duplica)', async () => {
    const { service, documents } = build({ rq: { conformityDocumentId: 90 } });
    await expect(service.create(200, 9, FIRMANTE)).rejects.toBeInstanceOf(ConflictException);
    expect(documents.createDocumentRaw).not.toHaveBeenCalled();
  });

  it('si el correo falla, el acta queda creada y lo informa para reenviar', async () => {
    const { service, items } = build({ emailFails: true });
    const out = await service.create(200, 9, FIRMANTE);
    expect(items.update).toHaveBeenCalled();
    expect(out.emailError).toMatch(/no se pudo enviar/i);
  });
});

describe('WorkItemConformityService: al firmar', () => {
  const firmado = { id: 70, fullName: 'Ana Pérez', conformityStatus: 'SIGNED', signedAt: new Date() };

  it('con todas las firmas: adjunta el PDF firmado, marca el acta y cierra el RQ', async () => {
    const { service, docs, docOrm, board } = build({ rq: { conformityDocumentId: 90 }, sigs: [firmado] });
    await service.handleSigned(90);
    expect(docs.upload).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: 200, kind: 'ACTA_CONFORMIDAD', status: 'VIGENTE', actorUserId: null }),
    );
    expect(docOrm.update).toHaveBeenCalledWith(90, { status: 'SIGNED' });
    expect(board.move).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: 200, actorUserId: 3, toStatus: 'CERRADO' }),
    );
  });

  it('si falta una firma no hace nada', async () => {
    const { service, board, docs } = build({
      rq: { conformityDocumentId: 90 },
      sigs: [firmado, { ...firmado, id: 71, conformityStatus: 'PENDING', signedAt: null }],
    });
    await service.handleSigned(90);
    expect(docs.upload).not.toHaveBeenCalled();
    expect(board.move).not.toHaveBeenCalled();
  });

  it('un documento que no es acta de ningún RQ se ignora', async () => {
    const { service, docs } = build({ sigs: [firmado] });
    await service.handleSigned(555);
    expect(docs.upload).not.toHaveBeenCalled();
  });

  it('ya firmada antes (aviso repetido): no la adjunta dos veces', async () => {
    const { service, docs } = build({ rq: { conformityDocumentId: 90 }, sigs: [firmado], doc: { status: 'SIGNED' } });
    await service.handleSigned(90);
    expect(docs.upload).not.toHaveBeenCalled();
  });

  it('un RQ ya cerrado no se vuelve a mover', async () => {
    const { service, board, docs } = build({ rq: { conformityDocumentId: 90, status: 'CERRADO' }, sigs: [firmado] });
    await service.handleSigned(90);
    expect(docs.upload).toHaveBeenCalled();
    expect(board.move).not.toHaveBeenCalled();
  });

  it('escucha las firmas al iniciar y un fallo no se propaga', async () => {
    const { service, signed$, documents } = build({ rq: { conformityDocumentId: 90 }, sigs: [firmado] });
    documents.getPdfBuffer.mockRejectedValueOnce(new Error('pdf roto'));
    service.onModuleInit();
    expect(() => signed$.next({ documentId: 90 })).not.toThrow();
    await new Promise((r) => setImmediate(r));
    service.onModuleDestroy();
  });
});
