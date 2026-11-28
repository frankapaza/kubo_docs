import { inflateRawSync } from 'zlib';
import { FindOperator } from 'typeorm';

import { Project } from '../entities/project.entity';
import { User } from '../../users/entities/user.entity';
import { ProjectDeliverable } from './entities/project-deliverable.entity';
import { ProjectDeliverableVersion } from './entities/project-deliverable-version.entity';
import { ExpedienteService, indexCsv, summarize } from './expediente.service';

const PDF = Buffer.from('%PDF-1.7\n' + 'x'.repeat(200));
const NOT_A_DOC = Buffer.from('MZ\x90\x00 ejecutable');

function matches(value: unknown, cond: unknown): boolean {
  if (cond instanceof FindOperator) {
    if (cond.type === 'in') return (cond.value as unknown[]).map(Number).includes(Number(value));
    if (cond.type === 'not') return !matches(value, cond.child ?? cond.value);
    if (cond.type === 'isNull') return value == null;
    throw new Error('operador no simulado: ' + cond.type);
  }
  return typeof cond === 'number' || typeof value === 'number' ? Number(value) === Number(cond) : value === cond;
}

/** Un repositorio en memoria con lo que usa el servicio. */
function fakeRepo(rows: any[], defaults: () => Record<string, unknown> = () => ({})) {
  let seq = 0;
  const where = (w: any = {}) => rows.filter((r) => Object.entries(w).every(([k, c]) => matches(r[k], c)));
  const sort = (list: any[], order: any) => {
    const [[k, dir]] = Object.entries(order ?? { id: 'ASC' }) as [string, string][];
    return [...list].sort((a, b) => (dir === 'DESC' ? -1 : 1) * (Number(a[k]) - Number(b[k])));
  };
  return {
    rows,
    find: jest.fn(async (o: any = {}) => sort(where(o.where), o.order)),
    findOne: jest.fn(async (o: any) => sort(where(o.where), o.order)[0] ?? null),
    findOneBy: jest.fn(async (w: any) => where(w)[0] ?? null),
    count: jest.fn(async (o: any) => where(o.where).length),
    insert: jest.fn(async (x: any) => {
      const row = { ...defaults(), ...x, id: ++seq, createdAt: new Date(), updatedAt: new Date() };
      rows.push(row);
      return { identifiers: [{ id: row.id }] };
    }),
    update: jest.fn(async (w: any, patch: any) => {
      const hit = where(w);
      for (const r of hit) Object.assign(r, patch, { updatedAt: new Date() });
      return { affected: hit.length };
    }),
    delete: jest.fn(async (w: any) => {
      const hit = where(w);
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return { affected: hit.length };
    }),
  };
}

function make() {
  const project: any = { id: 5, code: 'COB', name: 'Sistema de Cobranza', workType: null };
  const deliverables = fakeRepo([]);
  const versions = fakeRepo([]);
  const projects = fakeRepo([project]);
  const users = fakeRepo([{ id: 9, fullName: 'Ana Pérez' }]);
  const files = new Map<string, Buffer>();
  const storage = {
    save: jest.fn(async (b: Buffer, key: string) => {
      files.set(key, b);
      return { key, size: b.length };
    }),
    remove: jest.fn(async (key: string) => void files.delete(key)),
    createReadStream: jest.fn((key: string) => {
      const { Readable } = require('stream');
      return Readable.from([files.get(key)!]);
    }),
  };
  const byEntity = new Map<unknown, unknown>([
    [ProjectDeliverable, deliverables],
    [ProjectDeliverableVersion, versions],
    [Project, projects],
    [User, users],
  ]);
  const manager = {
    transaction: jest.fn(async (cb: any) => cb({ getRepository: (e: unknown) => byEntity.get(e) })),
  };
  for (const r of [deliverables, versions, projects, users]) (r as any).manager = manager;
  const svc = new ExpedienteService(deliverables as any, versions as any, projects as any, users as any, storage as any);
  return { svc, project, deliverables, versions, storage, files };
}

async function started(type: 'TRADICIONAL' | 'AGIL' | 'CORRECTIVO' = 'AGIL') {
  const t = make();
  await t.svc.setWorkType(t.project, type, 9);
  t.project.workType = type;
  const byType = (code: string) => t.deliverables.rows.find((r) => r.type === code)!;
  return { ...t, byType };
}

describe('ExpedienteService · tipo de trabajo', () => {
  it('al elegir el tipo crea los 20 entregables, numerados y con su obligatoriedad', async () => {
    const t = make();
    const view = await t.svc.setWorkType(t.project, 'AGIL', 9);
    expect(view.deliverables).toHaveLength(20);
    expect(view.project.workTypeLabel).toBe('Desarrollo ágil');
    const cro = view.deliverables.find((d) => d.type === 'CRO-PRO')!;
    expect(cro).toMatchObject({ requirement: 'NA', status: 'NO_APLICA', autoNa: true });
    expect(cro.naReason).toMatch(/desarrollo ágil/);
    const ini = view.deliverables[0];
    expect(ini).toMatchObject({ type: 'ACT-INI', correlative: 1, status: 'PENDIENTE', version: null });
    expect(ini.nomenclature).toBe('KUBO-COB-0001-ACT-INI Vx.y');
    expect(view.summary).toMatchObject({ total: 19, notApplicable: 1, pending: 19, approved: 0 });
  });

  it('cambiar el tipo recalcula: lo que deja de aplicar se marca solo y vuelve si aplica otra vez', async () => {
    const t = await started('AGIL');
    let view = await t.svc.setWorkType(t.project, 'CORRECTIVO', 9);
    expect(t.deliverables.rows).toHaveLength(20);
    expect(view.deliverables.find((d) => d.type === 'ACT-INI')).toMatchObject({ status: 'NO_APLICA', autoNa: true });
    expect(view.deliverables.find((d) => d.type === 'MAN-DES')).toMatchObject({ status: 'PENDIENTE', requirement: 'O' });
    view = await t.svc.setWorkType(t.project, 'TRADICIONAL', 9);
    expect(view.deliverables.find((d) => d.type === 'ACT-INI')).toMatchObject({ status: 'PENDIENTE', autoNa: false });
    expect(view.deliverables.find((d) => d.type === 'CRO-PRO')).toMatchObject({ status: 'PENDIENTE', requirement: 'O' });
  });

  it('un entregable ya trabajado o un «no aplica» puesto a mano no se tocan al cambiar el tipo', async () => {
    const t = await started('AGIL');
    await t.svc.upload(t.project, t.byType('ACT-INI').id, { buffer: PDF, filename: 'acta.pdf' }, 9);
    await t.svc.notApplicable(t.project, t.byType('ARQ-TIC').id, 'El cliente ya tiene su arquitectura', 9);
    await t.svc.setWorkType(t.project, 'CORRECTIVO', 9);
    expect(t.byType('ACT-INI')).toMatchObject({ status: 'BORRADOR', requirement: 'NA' });
    await t.svc.setWorkType(t.project, 'AGIL', 9);
    expect(t.byType('ARQ-TIC')).toMatchObject({ status: 'NO_APLICA', naReason: 'El cliente ya tiene su arquitectura' });
  });
});

describe('ExpedienteService · ciclo de un entregable', () => {
  it('versiones 0.1, 0.2 → revisión → observado → aprobado 1.0 → firmado; luego 1.1', async () => {
    const t = await started();
    const id = t.byType('DOC-ANA').id;
    let d = await t.svc.upload(t.project, id, { buffer: PDF, filename: 'análisis.pdf', note: 'Primer borrador' }, 9);
    expect(d).toMatchObject({ status: 'BORRADOR', version: '0.1', nomenclature: 'KUBO-COB-0003-DOC-ANA V0.1' });
    d = await t.svc.upload(t.project, id, { buffer: PDF, filename: 'análisis v2.pdf' }, 9);
    expect(d.version).toBe('0.2');
    expect(d.lastFile).toMatchObject({ filename: 'análisis v2.pdf', mimeType: 'application/pdf' });
    d = await t.svc.submit(t.project, id, null, 9);
    expect(d.status).toBe('EN_REVISION');
    d = await t.svc.observe(t.project, id, 'Falta el alcance', 9);
    expect(d).toMatchObject({ status: 'BORRADOR', version: '0.2' });
    d = await t.svc.approve(t.project, id, null, 9);
    expect(d).toMatchObject({ status: 'APROBADO', version: '1.0' });
    d = await t.svc.sign(t.project, id, { buffer: PDF, filename: 'firmado.pdf' }, null, 9);
    expect(d).toMatchObject({ status: 'FIRMADO', version: '1.0', lastFile: { filename: 'firmado.pdf' } });
    d = await t.svc.upload(t.project, id, { buffer: PDF, filename: 'ajuste.pdf' }, 9);
    expect(d).toMatchObject({ status: 'BORRADOR', version: '1.1' });

    const h = await t.svc.history(t.project, id);
    expect(h.map((x) => [x.action, x.version])).toEqual([
      ['E', '0.1'], ['E', '0.2'], ['R', '0.2'], ['R', '0.2'], ['A', '1.0'], ['F', '1.0'], ['E', '1.1'],
    ]);
    expect(h[0]).toMatchObject({ actionLabel: 'Elaborado', note: 'Primer borrador', actorName: 'Ana Pérez' });
    expect(h[3].note).toBe('Falta el alcance');
    expect(h[2].file).toBeNull();
  });

  it('no deja saltarse pasos', async () => {
    const t = await started();
    const id = t.byType('MAN-USU').id;
    await expect(t.svc.approve(t.project, id, null, 9)).rejects.toMatchObject({ status: 409 });
    await expect(t.svc.submit(t.project, id, null, 9)).rejects.toMatchObject({ status: 409 });
    await expect(t.svc.sign(t.project, id, null, null, 9)).rejects.toMatchObject({ status: 409 });
    await expect(t.svc.observe(t.project, id, ' ', 9)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.notApplicable(t.project, id, '', 9)).rejects.toMatchObject({ status: 400 });
  });

  it('«no aplica» con motivo y reabrir', async () => {
    const t = await started();
    const id = t.byType('ACT-TRA').id;
    let d = await t.svc.notApplicable(t.project, id, 'No hay transferencia: lo opera Kubo', 9);
    expect(d).toMatchObject({ status: 'NO_APLICA', naReason: 'No hay transferencia: lo opera Kubo', autoNa: false });
    await expect(t.svc.upload(t.project, id, { buffer: PDF, filename: 'x.pdf' }, 9)).rejects.toMatchObject({ status: 409 });
    d = await t.svc.reopen(t.project, id, 9);
    expect(d).toMatchObject({ status: 'PENDIENTE', naReason: null });
  });

  it('rechaza un archivo que no es documento y no deja nada en disco', async () => {
    const t = await started();
    const id = t.byType('MAN-DES').id;
    await expect(t.svc.upload(t.project, id, { buffer: NOT_A_DOC, filename: 'manual.pdf' }, 9)).rejects.toMatchObject({
      status: 415,
    });
    expect(t.storage.save).not.toHaveBeenCalled();
    expect(t.byType('MAN-DES').status).toBe('PENDIENTE');
  });

  it('si otra persona cambió el entregable a la vez, no se pisa y se borra el archivo subido', async () => {
    const t = await started();
    const id = t.byType('MAN-DES').id;
    const realUpdate = t.deliverables.update.getMockImplementation()!;
    t.deliverables.update.mockImplementationOnce(async (w: any, p: any) => {
      t.byType('MAN-DES').status = 'BORRADOR'; // alguien subió una versión entre la lectura y la escritura
      return realUpdate(w, p);
    });
    await expect(t.svc.upload(t.project, id, { buffer: PDF, filename: 'm.pdf' }, 9)).rejects.toMatchObject({ status: 409 });
    expect(t.versions.rows).toHaveLength(0);
    expect(t.files.size).toBe(0);
  });

  it('un entregable de otro proyecto no se alcanza cambiando el id', async () => {
    const t = await started();
    const id = t.byType('MAN-DES').id;
    const otro: any = { id: 6, code: 'OTR', name: 'Otro', workType: 'AGIL' };
    await expect(t.svc.upload(otro, id, { buffer: PDF, filename: 'm.pdf' }, 9)).rejects.toMatchObject({ status: 404 });
    await expect(t.svc.history(otro, id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('ExpedienteService · cambios a la vez (revisión)', () => {
  it('cambiar el tipo de trabajo no pisa una versión subida mientras tanto', async () => {
    const t = await started('AGIL');
    const live = t.byType('ACT-INI');
    const stale = t.deliverables.rows.map((r) => ({ ...r }));
    live.status = 'BORRADOR'; // otra persona subió V0.1 después de que se leyera la lista
    live.versionMinor = 1;
    t.deliverables.find.mockImplementationOnce(async () => stale);
    await t.svc.setWorkType(t.project, 'CORRECTIVO', 9);
    expect(t.byType('ACT-INI')).toMatchObject({ status: 'BORRADOR', autoNa: 0 });
  });

  it('quitar un agregado que recibió una versión a la vez falla en vez de borrar su historial', async () => {
    const t = await started();
    const d = await t.svc.add(t.project, 'ACT-REU', null);
    t.versions.count.mockImplementationOnce(async () => {
      const row = t.deliverables.rows.find((r) => r.id === d.id)!;
      row.status = 'BORRADOR';
      row.versionMinor = 1;
      return 0;
    });
    await expect(t.svc.remove(t.project, d.id)).rejects.toMatchObject({ status: 409 });
    expect(t.deliverables.rows.some((r) => r.id === d.id)).toBe(true);
  });

  it('no arma dos .zip del mismo proceso a la vez', async () => {
    const t = await started();
    const [a, b] = await Promise.allSettled([t.svc.zip(t.project), t.svc.zip(t.project)]);
    expect(a.status).toBe('fulfilled');
    expect(b).toMatchObject({ status: 'rejected', reason: { status: 429 } });
    await expect(t.svc.zip(t.project)).resolves.toBeDefined();
  });
});

describe('ExpedienteService · agregados a mano', () => {
  it('otra acta de reunión toma el siguiente correlativo y se puede borrar mientras no tenga historial', async () => {
    const t = await started();
    const d = await t.svc.add(t.project, 'ACT-REU', 'Acta de reunión · avance 2');
    expect(d).toMatchObject({ correlative: 21, requirement: 'OP', fromCatalog: false, name: 'Acta de reunión · avance 2' });
    expect(d.nomenclature).toBe('KUBO-COB-0021-ACT-REU Vx.y');
    await t.svc.remove(t.project, d.id);
    expect(t.deliverables.rows).toHaveLength(20);
  });

  it('no borra uno del catálogo ni uno con historial; exige el tipo de trabajo antes', async () => {
    const t = await started();
    await expect(t.svc.remove(t.project, t.byType('ACT-INI').id)).rejects.toMatchObject({ status: 409 });
    const d = await t.svc.add(t.project, 'SOL-CAM', null);
    await t.svc.upload(t.project, d.id, { buffer: PDF, filename: 'cambio.pdf' }, 9);
    await expect(t.svc.remove(t.project, d.id)).rejects.toMatchObject({ status: 409 });
    await expect(t.svc.add(t.project, 'XXX', null)).rejects.toMatchObject({ status: 400 });
    const nuevo = make();
    await expect(nuevo.svc.add(nuevo.project, 'ACT-REU', null)).rejects.toMatchObject({ status: 409 });
  });
});

describe('ExpedienteService · descarga del expediente', () => {
  function entries(zip: Buffer): Record<string, Buffer> {
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let p = zip.readUInt32LE(eocd + 16);
    const out: Record<string, Buffer> = {};
    for (let i = 0; i < zip.readUInt16LE(eocd + 10); i++) {
      const method = zip.readUInt16LE(p + 10);
      const size = zip.readUInt32LE(p + 20);
      const nameLen = zip.readUInt16LE(p + 28);
      const local = zip.readUInt32LE(p + 42);
      const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(start, start + size);
      out[name] = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
      p += 46 + nameLen;
    }
    return out;
  }

  it('lleva el último archivo de cada entregable con su nomenclatura, por fase, y el índice', async () => {
    const t = await started();
    await t.svc.upload(t.project, t.byType('ACT-INI').id, { buffer: PDF, filename: 'inicio.pdf' }, 9);
    await t.svc.approve(t.project, t.byType('ACT-INI').id, null, 9);
    await t.svc.upload(t.project, t.byType('MAN-DES').id, { buffer: PDF, filename: 'deploy.pdf' }, 9);
    const z = await t.svc.zip(t.project);
    expect(z.filename).toMatch(/^KUBO-COB-Expediente-\d{4}-\d{2}-\d{2}\.zip$/);
    const files = entries(z.buffer);
    expect(Object.keys(files).sort()).toEqual([
      '1. Inicio/KUBO-COB-0001-ACT-INI V1.0.pdf',
      '3. Ejecución/KUBO-COB-0013-MAN-DES V0.1.pdf',
      'indice.csv',
    ]);
    expect(files['1. Inicio/KUBO-COB-0001-ACT-INI V1.0.pdf'].equals(PDF)).toBe(true);
    const csv = files['indice.csv'].toString('utf8');
    expect(csv.startsWith('﻿Correlativo;Código;Entregable')).toBe(true);
    expect(csv).toContain('0001;ACT-INI;Acta de inicio;Inicio;Obligatorio;Aprobado;1.0;KUBO-COB-0001-ACT-INI V1.0;1. Inicio/KUBO-COB-0001-ACT-INI V1.0.pdf;');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(21);
  });

  it('el archivo lleva la extensión de su tipo real, no la del nombre subido', async () => {
    const t = await started();
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(64)]);
    await t.svc.upload(t.project, t.byType('ARQ-TIC').id, { buffer: png, filename: 'diagrama.docx' }, 9);
    const names = Object.keys(entries((await t.svc.zip(t.project)).buffer));
    expect(names).toContain('2. Planificación/KUBO-COB-0006-ARQ-TIC V0.1.png');
  });
});

describe('índice y resumen', () => {
  it('el CSV neutraliza fórmulas y escapa el separador', () => {
    const view: any = {
      deliverables: [
        { id: 1, correlative: 1, type: 'SOL-CAM', name: '=HYPERLINK("x")', phaseLabel: 'Monitoreo y control', requirement: 'OP', statusLabel: 'Pendiente', version: null, nomenclature: 'n', naReason: 'a;b' },
      ],
    };
    const line = indexCsv(view, new Map()).toString('utf8').split('\r\n')[1];
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain('"a;b"');
  });

  it('el resumen no cuenta lo que no aplica y da el avance por fase', () => {
    const d = (phase: string, status: string, requirement = 'O') => ({ phase, status, requirement }) as any;
    const s = summarize([d('INICIO', 'FIRMADO'), d('INICIO', 'NO_APLICA'), d('CIERRE', 'EN_REVISION'), d('CIERRE', 'PENDIENTE', 'OP')]);
    expect(s).toMatchObject({ total: 3, required: 2, approved: 1, inProgress: 1, pending: 1, notApplicable: 1 });
    expect(s.phases.find((p) => p.phase === 'INICIO')).toMatchObject({ total: 1, done: 1 });
  });
});
