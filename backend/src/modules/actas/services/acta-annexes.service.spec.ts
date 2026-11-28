import { ActaAnnexesService, MAX_ANNEX_IMAGE_BYTES } from './acta-annexes.service';

const JPG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(100)]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(100)]);
const USER = { id: 9, role: 'ADMIN' } as any;

function make() {
  const rows: any[] = [];
  const repo = {
    find: jest.fn(async ({ where }: any) => rows.filter((r) => r.actaId === where.actaId).sort((a, b) => a.position - b.position)),
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => { if (!x.id) { x.id = rows.length + 1; rows.push(x); } return x; }),
    delete: jest.fn(async ({ id }: any) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); }),
  };
  const actas = { findOne: jest.fn(async ({ where }: any) => (where.id === 3 ? { id: 3 } : null)) };
  return { svc: new ActaAnnexesService(repo as any, actas as any), rows };
}

describe('ActaAnnexesService', () => {
  it('agrega fotos con texto y solo texto, en orden; la respuesta no lleva la imagen', async () => {
    const t = make();
    const a = await t.svc.create(3, { caption: 'Pizarra con acuerdos' }, { buffer: JPG, mimetype: 'image/jpeg' }, USER);
    const b = await t.svc.create(3, { caption: 'El cliente cambia de central en enero' }, null, USER);
    expect(a).toMatchObject({ position: 1, imageMime: 'image/jpeg', hasImage: true, place: 'ANEXO', section: null });
    expect(b).toMatchObject({ position: 2, hasImage: false });
    expect(JSON.stringify(a)).not.toContain('"image":');
    expect((await t.svc.list(3)).map((x) => x.caption)).toEqual(['Pizarra con acuerdos', 'El cliente cambia de central en enero']);
  });

  it('una evidencia de una sección puede ir en la sección (INLINE) o en anexos', async () => {
    const t = make();
    const a = await t.svc.create(3, { caption: 'Diagrama', section: '1.2', place: 'INLINE' }, { buffer: PNG, mimetype: 'image/png' }, USER);
    expect(a).toMatchObject({ section: '1.2', place: 'INLINE' });
    const moved = await t.svc.update(a.id, { place: 'ANEXO' });
    expect(moved.place).toBe('ANEXO');
  });

  it('exige foto o texto; solo JPEG o PNG reales y de tamaño razonable', async () => {
    const t = make();
    await expect(t.svc.create(3, { caption: '  ' }, null, USER)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.create(3, {}, { buffer: Buffer.from('GIF89a'), mimetype: 'image/gif' }, USER)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.create(3, {}, { buffer: Buffer.from('no es jpg'), mimetype: 'image/jpeg' }, USER)).rejects.toMatchObject({ status: 400 });
    const grande = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(MAX_ANNEX_IMAGE_BYTES)]);
    await expect(t.svc.create(3, {}, { buffer: grande, mimetype: 'image/jpeg' }, USER)).rejects.toMatchObject({ status: 400 });
  });

  it('acta inexistente: 404', async () => {
    const t = make();
    await expect(t.svc.create(99, { caption: 'x' }, null, USER)).rejects.toMatchObject({ status: 404 });
  });

  it('quitar renumera el orden', async () => {
    const t = make();
    const a = await t.svc.create(3, { caption: 'uno' }, null, USER);
    await t.svc.create(3, { caption: 'dos' }, null, USER);
    await t.svc.create(3, { caption: 'tres' }, null, USER);
    await t.svc.remove(a.id);
    expect((await t.svc.list(3)).map((x) => [x.caption, x.position])).toEqual([['dos', 1], ['tres', 2]]);
  });
});
