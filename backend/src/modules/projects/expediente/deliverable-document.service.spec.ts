import { deflateSync } from 'zlib';

import { crc32 } from '../../../common/zip/zip-writer';
import { DeliverableDocumentService } from './deliverable-document.service';
import { DeliverablePdfRenderer, numberAttachments } from './deliverable-pdf.renderer';
import { __test as jsonLimit } from './document-json-limit';

/** Un PNG real (gris) de w × h, para pdfkit y el control de dimensiones. */
export function makePng(w = 4, h = 3): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 0; // escala de grises
  const raw = Buffer.alloc((w + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SECTIONS = [
  { key: 'sec-1', num: '1.1', title: 'Objetivo', body: 'Hacer un sistema para cobranza.' },
  { key: 'sec-2', num: '1.2', title: 'Alcance', body: 'Cartera y lo de la central.' },
];

function make(opts: { status?: string; llm?: string } = {}) {
  const row: any = { id: 7, projectId: 5, type: 'DOC-ANA', name: 'Documento de análisis', status: opts.status ?? 'BORRADOR' };
  const project: any = { id: 5, code: 'COB', name: 'Cobranza', clientId: 3 };
  const templates: any[] = [];
  const atts: any[] = [];
  let seq = 0;
  const expediente = {
    deliverableOf: jest.fn(async (_p: any, id: number) => {
      if (id !== 7) throw Object.assign(new Error('no'), { status: 404 });
      return row;
    }),
    loadDocument: jest.fn(async () => ({
      deliverable: { id: 7, type: 'DOC-ANA', version: null, status: row.status },
      sections: null,
      versionId: null,
    })),
  };
  const llm = { chat: jest.fn(async () => opts.llm ?? '{"sections":[{"key":"sec-2","body":"Cartera, con integración a la central telefónica."}]}') };
  const match = (r: any, w: any) => Object.entries(w).every(([k, v]) => r[k] === v);
  const tplRepo = {
    findOne: jest.fn(async ({ where }: any) => templates.find((r) => match(r, where)) ?? null),
    find: jest.fn(async () => templates),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => {
      const i = templates.findIndex((r) => r.type === x.type && r.clientId === x.clientId);
      const v = { updatedAt: new Date(), ...x };
      if (i >= 0) templates[i] = v;
      else templates.push(v);
      return v;
    }),
    delete: jest.fn(async (w: any) => {
      const i = templates.findIndex((r) => match(r, w));
      if (i >= 0) templates.splice(i, 1);
    }),
  };
  const attRepo = {
    find: jest.fn(async ({ where }: any) => atts.filter((a) => a.deliverableId === where.deliverableId).sort((a, b) => a.position - b.position)),
    findOne: jest.fn(async ({ where }: any) => atts.find((a) => match(a, where)) ?? null),
    count: jest.fn(async ({ where }: any) => atts.filter((a) => a.deliverableId === where.deliverableId).length),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => {
      const v = { ...x, id: ++seq };
      atts.push(v);
      return v;
    }),
    update: jest.fn(async ({ id }: any, patch: any) => Object.assign(atts.find((a) => a.id === id), patch)),
    delete: jest.fn(async ({ id }: any) => atts.splice(atts.findIndex((a) => a.id === id), 1)),
  };
  const clients = { findOne: jest.fn(async ({ where }: any) => (where.id === 3 ? { id: 3, razonSocial: 'PRODUCE' } : null)) };
  const svc = new DeliverableDocumentService(expediente as any, llm as any, tplRepo as any, attRepo as any, clients as any);
  return { svc, project, row, templates, atts, llm, expediente };
}

describe('plantillas por cliente', () => {
  it('usa la del cliente; si no, la de Kubo editada; si no, la del código', async () => {
    const t = make();
    expect((await t.svc.resolveTemplate('DOC-ANA', 3)).source).toBe('KUBO');
    await t.svc.saveTemplate('DOC-ANA', null, 'Kubo v2', [{ num: '1', title: 'Resumen' }], 9);
    expect(await t.svc.resolveTemplate('DOC-ANA', 3)).toMatchObject({ source: 'KUBO_EDITADA', name: 'Kubo v2' });
    await t.svc.saveTemplate('DOC-ANA', 3, 'Formato PRODUCE', [{ num: '1', title: 'Introducción', guide: 'antecedentes' }], 9);
    const r = await t.svc.resolveTemplate('DOC-ANA', 3);
    expect(r).toMatchObject({ source: 'CLIENTE', name: 'Formato PRODUCE', clientId: 3 });
    expect(r.sections).toEqual([{ num: '1', title: 'Introducción', guide: 'antecedentes' }]);
    await t.svc.removeTemplate('DOC-ANA', 3);
    expect((await t.svc.resolveTemplate('DOC-ANA', 3)).source).toBe('KUBO_EDITADA');
  });

  it('valida tipo, nombre y cliente', async () => {
    const t = make();
    await expect(t.svc.saveTemplate('XXX', null, 'a', [{ title: 'b' }], 9)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.saveTemplate('DOC-ANA', null, ' ', [{ title: 'b' }], 9)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.saveTemplate('DOC-ANA', 99, 'a', [{ title: 'b' }], 9)).rejects.toMatchObject({ status: 404 });
  });

  it('un documento nuevo arranca con la plantilla del cliente del proyecto', async () => {
    const t = make();
    await t.svc.saveTemplate('DOC-ANA', 3, 'Formato PRODUCE', [{ num: '1', title: 'Introducción' }], 9);
    const doc = await t.svc.getDocument(t.project, 7);
    expect(doc).toMatchObject({ saved: false, template: { source: 'CLIENTE', name: 'Formato PRODUCE' }, attachmentsEditable: true });
    expect(doc.sections).toEqual([{ key: 'sec-1', num: '1', title: 'Introducción', body: '[Completar]', status: 'PENDIENTE' }]);
  });
});

describe('ajuste con IA', () => {
  it('propone solo la sección pedida, con su antes y después, sin guardar', async () => {
    const t = make();
    const r = await t.svc.aiAdjust(t.project, 7, { scope: 'SECTION', sectionKey: 'sec-2', instruction: 'Más formal', sections: SECTIONS });
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ key: 'sec-2', before: 'Cartera y lo de la central.', after: 'Cartera, con integración a la central telefónica.' });
    expect(r.changes[0].diff.some((x) => x.op === 'ins')).toBe(true);
    const prompt = (t.llm.chat.mock.calls[0] as any)[1][0].content as string;
    expect(prompt).toContain('cliente: PRODUCE');
    expect(prompt).toContain('"key":"sec-2"');
    expect(prompt).not.toContain('"key":"sec-1"');
  });

  it('en todo el documento ignora secciones inventadas y separa las que no cambian', async () => {
    const t = make({ llm: '{"sections":[{"key":"sec-1","body":"Hacer un sistema para cobranza."},{"key":"sec-2","body":"Nuevo"},{"key":"sec-x","body":"?"}]}' });
    const r = await t.svc.aiAdjust(t.project, 7, { scope: 'DOCUMENT', instruction: 'Corregir ortografía', sections: SECTIONS });
    expect(r.changes.map((c) => c.key)).toEqual(['sec-2']);
    expect(r.unchanged).toEqual(['sec-1']);
  });

  it('valida el pedido, el alcance y el estado', async () => {
    const t = make();
    await expect(t.svc.aiAdjust(t.project, 7, { scope: 'SECTION', sectionKey: 'nope', instruction: 'x', sections: SECTIONS })).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.aiAdjust(t.project, 7, { scope: 'DOCUMENT', instruction: ' ', sections: SECTIONS })).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.aiAdjust(t.project, 7, { scope: 'X', instruction: 'x', sections: SECTIONS })).rejects.toMatchObject({ status: 400 });
    const na = make({ status: 'NO_APLICA' });
    await expect(na.svc.aiAdjust(na.project, 7, { scope: 'DOCUMENT', instruction: 'x', sections: SECTIONS })).rejects.toMatchObject({ status: 409 });
    const broken = make({ llm: 'lo siento' });
    await expect(broken.svc.aiAdjust(broken.project, 7, { scope: 'DOCUMENT', instruction: 'x', sections: SECTIONS })).rejects.toMatchObject({ status: 502 });
  });
});

describe('imágenes por sección', () => {
  it('agrega, mueve a anexos, cambia la leyenda y renumera al quitar', async () => {
    const t = make();
    const a = await t.svc.addAttachment(t.project, 7, { sectionKey: 'sec-2', caption: 'Diagrama' }, { buffer: makePng() }, 9);
    const b = await t.svc.addAttachment(t.project, 7, { sectionKey: 'sec-1', place: 'ANEXO' }, { buffer: makePng() }, 9);
    expect(a).toMatchObject({ place: 'INLINE', position: 1, imageMime: 'image/png', caption: 'Diagrama' });
    expect(b).toMatchObject({ place: 'ANEXO', position: 2 });
    expect(JSON.stringify(a)).not.toContain('image":');
    const moved = await t.svc.updateAttachment(t.project, 7, a.id, { place: 'ANEXO', caption: 'Integración con la central' });
    expect(moved).toMatchObject({ place: 'ANEXO', caption: 'Integración con la central' });
    await t.svc.removeAttachment(t.project, 7, a.id);
    expect(t.atts.map((x) => [x.id, x.position])).toEqual([[b.id, 1]]);
  });

  it('solo JPEG o PNG reales, sección válida, y nada cambia si está aprobado', async () => {
    const t = make();
    await expect(t.svc.addAttachment(t.project, 7, { sectionKey: 'sec-1' }, { buffer: Buffer.from('GIF89a....') }, 9)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.addAttachment(t.project, 7, { sectionKey: '../x' }, { buffer: makePng() }, 9)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.addAttachment(t.project, 7, { sectionKey: 'sec-1', place: 'FONDO' }, { buffer: makePng() }, 9)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.addAttachment(t.project, 7, { sectionKey: 'sec-1' }, { buffer: makePng(7000, 2) }, 9)).rejects.toThrow();
    const ap = make({ status: 'APROBADO' });
    await expect(ap.svc.addAttachment(ap.project, 7, { sectionKey: 'sec-1' }, { buffer: makePng() }, 9)).rejects.toMatchObject({ status: 409 });
  });

  it('una imagen de otro entregable no se alcanza', async () => {
    const t = make();
    await expect(t.svc.attachmentImage(t.project, 8, 1)).rejects.toMatchObject({ status: 404 });
  });
});

describe('PDF del documento', () => {
  it('numera figuras y anexos en el orden del documento', () => {
    const n = numberAttachments(SECTIONS, [
      { sectionKey: 'sec-2', place: 'INLINE', caption: 'b', image: Buffer.alloc(0) },
      { sectionKey: 'sec-1', place: 'ANEXO', caption: 'a', image: Buffer.alloc(0) },
      { sectionKey: 'sec-1', place: 'INLINE', caption: 'c', image: Buffer.alloc(0) },
      { sectionKey: 'borrada', place: 'INLINE', caption: 'd', image: Buffer.alloc(0) },
    ]);
    expect(n.map((x) => [x.caption, x.figure, x.annex])).toEqual([
      ['a', null, 1],
      ['c', 1, null],
      ['b', 2, null],
    ]);
  });

  it('arma un PDF válido con figuras, anexos y una imagen dañada sin caerse', async () => {
    const buf = await new DeliverablePdfRenderer().render({
      title: 'Documento de análisis',
      nomenclature: 'KUBO-COB-0003-DOC-ANA V0.1',
      version: '0.1',
      statusLabel: 'Borrador',
      projectName: 'Cobranza',
      projectCode: 'COB',
      clientName: 'PRODUCE',
      sections: SECTIONS,
      history: [{ version: '0.1', actionLabel: 'Elaborado', actorName: 'Ana', createdAt: new Date().toISOString(), note: 'Borrador' }],
      attachments: [
        { sectionKey: 'sec-1', place: 'INLINE', caption: 'Pantalla', image: makePng(40, 20) },
        { sectionKey: 'sec-2', place: 'ANEXO', caption: 'Foto', image: makePng(20, 40) },
        { sectionKey: 'sec-2', place: 'INLINE', caption: 'Dañada', image: Buffer.from('no es imagen') },
      ],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(2000);
  });
});

describe('límite de JSON del documento', () => {
  it('solo guardar el documento y el ajuste con IA', () => {
    const re = jsonLimit.RUTAS_DEL_DOCUMENTO;
    expect(re.test('/api/v1/projects/5/expediente/deliverables/7/document')).toBe(true);
    expect(re.test('/api/v1/projects/5/expediente/deliverables/7/document/ai-adjust')).toBe(true);
    expect(re.test('/api/v1/projects/5/expediente/deliverables/7/document/attachments')).toBe(false);
    expect(re.test('/api/v1/projects/5/expediente')).toBe(false);
  });
});
