import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AvailabilityEvidenceService, contentDisposition, EVIDENCE_MAX_BYTES } from './availability-evidence.service';

const make = (incidentExists = true) => {
  const rows: any[] = [];
  const evidence = {
    create: jest.fn((d: any) => ({ ...d })),
    save: jest.fn(async (r: any) => {
      const row = { id: 9, createdAt: new Date(), ...r };
      rows.push(row);
      return row;
    }),
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  const incidents = { findOne: jest.fn(async () => (incidentExists ? { id: 5 } : null)) };
  const users = { find: jest.fn(async () => [{ id: 3, fullName: 'Ana Pérez' }]) };
  const storage = {
    save: jest.fn(async (_b: Buffer, key: string) => ({ key, size: 1 })),
    remove: jest.fn(async () => undefined),
    createReadStream: jest.fn(() => 'STREAM'),
  };
  const svc = new AvailabilityEvidenceService(evidence as any, incidents as any, users as any, storage as any);
  return { svc, rows, evidence, storage };
};
const file = (name: string, size = 10) => ({ originalname: name, buffer: Buffer.alloc(size, 1), size });

describe('AvailabilityEvidenceService', () => {
  it('rechaza .exe con 400 EVIDENCIA_TIPO y no guarda nada', async () => {
    const { svc, storage } = make();
    const err: any = await svc.upload(5, file('a.exe'), { origin: 'OFICINA' }, 3).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().code).toBe('EVIDENCIA_TIPO');
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('la extensión se valida sin distinguir mayúsculas', async () => {
    const { svc } = make();
    await expect(svc.upload(5, file('WINMTR.TXT'), { origin: 'OFICINA' }, 3)).resolves.toBeDefined();
  });

  it('rechaza 2 MB + 1 byte con 400', async () => {
    const { svc } = make();
    await expect(svc.upload(5, file('a.txt', EVIDENCE_MAX_BYTES + 1), { origin: 'OFICINA' }, 3)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('incidente inexistente da 404', async () => {
    const { svc } = make(false);
    await expect(svc.upload(5, file('a.txt'), { origin: 'OFICINA' }, 3)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('guarda con la clave esperada, pasa el buffer y devuelve la vista con el nombre del autor', async () => {
    const { svc, storage, evidence } = make();
    const f = file('C:\\x\\winmtr.html');
    const v = await svc.upload(5, f, { origin: 'SERVIDOR', notes: ' nota ', capturedAt: '2026-11-20T10:00:00.000Z' }, 3);
    const [buf, key, mime] = storage.save.mock.calls[0] as any[];
    expect(buf).toBe(f.buffer);
    expect(key).toMatch(/^availability\/evidence\/5\/[0-9a-f-]{36}\.html$/);
    expect(mime).toBe('text/html');
    expect(evidence.create.mock.calls[0][0]).toMatchObject({ fileName: 'winmtr.html', notes: 'nota', createdBy: 3, origin: 'SERVIDOR' });
    expect(v).toMatchObject({ id: 9, fileName: 'winmtr.html', createdByName: 'Ana Pérez', origin: 'SERVIDOR' });
  });

  it('si falla la fila, retira el archivo huérfano', async () => {
    const { svc, evidence, storage } = make();
    evidence.save.mockRejectedValueOnce(new Error('db'));
    await expect(svc.upload(5, file('a.txt'), { origin: 'OTRO' }, 3)).rejects.toThrow('db');
    expect(storage.remove).toHaveBeenCalled();
  });

  it('borrar llama a storage.remove y borra la fila', async () => {
    const { svc, rows, storage, evidence } = make();
    rows.push({ id: 9, storageKey: 'k/1.txt' });
    await svc.remove(9);
    expect(storage.remove).toHaveBeenCalledWith('k/1.txt');
    expect(evidence.delete).toHaveBeenCalledWith({ id: 9 });
    await expect(svc.remove(77)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listForIncidents agrupa por incidente', async () => {
    const { svc, rows } = make();
    const base = { origin: 'OTRO', notes: null, fileName: 'f', sizeBytes: 1, capturedAt: new Date(), createdBy: 3 };
    rows.push({ id: 1, incidentId: 5, ...base }, { id: 2, incidentId: 6, ...base }, { id: 3, incidentId: 5, ...base, createdBy: null });
    const m = await svc.listForIncidents([5, 6, 7]);
    expect(m.get(5)!.map((e) => e.id)).toEqual([1, 3]);
    expect(m.get(5)![0].createdByName).toBe('Ana Pérez');
    expect(m.get(5)![1].createdByName).toBeNull();
    expect(m.get(6)).toHaveLength(1);
    expect(m.has(7)).toBe(false);
    expect((await svc.listForIncidents([])).size).toBe(0);
  });
});

describe('contentDisposition', () => {
  it('quita separadores, comillas y control; ASCII simple va solo con filename', () => {
    expect(contentDisposition('..\\a/"b".txt')).toBe('attachment; filename="b.txt"');
    expect(contentDisposition('a\r\nb.txt')).toBe('attachment; filename="ab.txt"');
  });
  it('no ASCII añade filename* RFC 5987', () => {
    expect(contentDisposition('señal.txt')).toBe("attachment; filename=\"se_al.txt\"; filename*=UTF-8''se%C3%B1al.txt");
  });
});
