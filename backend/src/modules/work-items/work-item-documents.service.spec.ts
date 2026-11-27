import { BadRequestException, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';

import { WorkItemDocumentsService } from './work-item-documents.service';

const PDF = Buffer.from('%PDF-1.7\ncontenido');

function build(over: { rows?: object[] } = {}) {
  const rows: Array<Record<string, unknown>> = [...((over.rows ?? []) as Array<Record<string, unknown>>)];
  const repo = {
    find: jest.fn().mockImplementation(async () => rows),
    findOneBy: jest.fn().mockImplementation(async (w: { id: number; workItemId: number }) =>
      rows.find((r) => Number(r.id) === Number(w.id) && Number(r.workItemId) === Number(w.workItemId)) ?? null,
    ),
    create: jest.fn().mockImplementation((x) => x),
    save: jest.fn().mockImplementation(async (x) => ({ id: 7, createdAt: new Date('2026-11-24T10:00:00Z'), ...x })),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const items = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 200, code: 'RQ-0045' }) };
  const events = { record: jest.fn().mockResolvedValue({ id: 1 }) };
  const storage = {
    save: jest.fn().mockResolvedValue({ key: 'k', size: 1 }),
    createReadStream: jest.fn().mockReturnValue({ on: jest.fn() }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const service = new WorkItemDocumentsService(repo as never, items as never, events as never, storage as never);
  return { service, repo, items, events, storage };
}

describe('WorkItemDocumentsService.upload', () => {
  it('guarda un PDF con clave del servidor y deja constancia en el historial', async () => {
    const { service, storage, repo, events } = build();
    const doc = await service.upload({
      workItemId: 200, actorUserId: 9, kind: 'ESPECIFICACION', buffer: PDF, filename: 'espec\nificación.pdf',
    });
    const key = storage.save.mock.calls[0][1] as string;
    expect(key).toMatch(/^work-items\/200\/[0-9a-f-]{36}\.pdf$/);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ESPECIFICACION', status: 'VIGENTE', source: 'WEB', mimeType: 'application/pdf' }),
    );
    expect(doc.filename).not.toContain('\n');
    expect(doc.kindLabel).toBe('Especificación del requerimiento');
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ workItemId: 200, type: 'COMMENT' }));
  });

  it('rechaza un tipo no admitido sin escribir en disco', async () => {
    const { service, storage } = build();
    await expect(
      service.upload({ workItemId: 200, actorUserId: 9, kind: 'OTRO', buffer: Buffer.from('hola'), filename: 'x.txt' }),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rechaza un tipo de documento desconocido', async () => {
    const { service } = build();
    await expect(
      service.upload({ workItemId: 200, actorUserId: 9, kind: 'FACTURA' as never, buffer: PDF, filename: 'x.pdf' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('si no se puede guardar la fila, borra el archivo escrito', async () => {
    const { service, repo, storage } = build();
    repo.save.mockRejectedValueOnce(new Error('db caída'));
    await expect(
      service.upload({ workItemId: 200, actorUserId: 9, kind: 'OTRO', buffer: PDF, filename: 'x.pdf' }),
    ).rejects.toThrow();
    expect(storage.remove).toHaveBeenCalledWith(storage.save.mock.calls[0][1]);
  });
});

describe('WorkItemDocumentsService: aprobar y quitar', () => {
  const BORRADOR = {
    id: 7, workItemId: 200, kind: 'MANUAL_USUARIO', status: 'BORRADOR', source: 'CLAUDE', filename: 'manual.pdf',
    storageKey: 'work-items/200/a.pdf', mimeType: 'application/pdf', sizeBytes: 10, createdAt: new Date(),
  };

  it('aprobar pasa el borrador a vigente con quién y cuándo', async () => {
    const { service, repo } = build({ rows: [BORRADOR] });
    const doc = await service.approve(200, 7, 9);
    expect(doc.status).toBe('VIGENTE');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'VIGENTE', approvedByUserId: 9 }));
  });

  it('un documento de otro requerimiento no existe (404)', async () => {
    const { service } = build({ rows: [BORRADOR] });
    await expect(service.approve(999, 7, 9)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(999, 7, 9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('quitar borra la fila y el archivo', async () => {
    const { service, repo, storage } = build({ rows: [BORRADOR] });
    await service.remove(200, 7, 9);
    expect(repo.delete).toHaveBeenCalledWith({ id: 7 });
    expect(storage.remove).toHaveBeenCalledWith('work-items/200/a.pdf');
  });
});

describe('WorkItemDocumentsService.renderManualPdf', () => {
  it('genera un PDF desde Markdown', async () => {
    const { service } = build();
    const pdf = await service.renderManualPdf('RQ-0045 · Manual de usuario', '# Cómo exportar\n\n1. Abre **Pagos**');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('WorkItemDocumentsService: archivos de un requerimiento borrado', () => {
  it('storageKeysOf + discardFiles borra cada archivo y no falla si uno no se puede borrar', async () => {
    const rows = [
      { id: 1, workItemId: 200, storageKey: 'work-items/200/a.pdf' },
      { id: 2, workItemId: 200, storageKey: 'work-items/200/b.docx' },
    ];
    const { service, storage } = build({ rows });
    const keys = await service.storageKeysOf(200);
    expect(keys).toEqual(['work-items/200/a.pdf', 'work-items/200/b.docx']);
    storage.remove.mockRejectedValueOnce(new Error('ENOENT'));
    await expect(service.discardFiles(keys)).resolves.toBeUndefined();
    expect(storage.remove).toHaveBeenCalledTimes(2);
  });
});
