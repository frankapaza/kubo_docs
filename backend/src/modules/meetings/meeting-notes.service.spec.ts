import { MeetingNotesService } from './meeting-notes.service';

function make() {
  const rows: any[] = [];
  const repo = {
    find: jest.fn(async ({ where }: any) => rows.filter((r) => r.meetingId === where.meetingId).sort((a, b) => a.offsetSec - b.offsetSec)),
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => { if (!x.id) { x.id = rows.length + 1; rows.push(x); } return x; }),
    delete: jest.fn(async ({ id }: any) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); }),
  };
  const meetings = { findByIdOrFail: jest.fn(async (id: number) => { if (id !== 1) throw Object.assign(new Error('nf'), { status: 404 }); return { id: 1 }; }) };
  return { svc: new MeetingNotesService(repo as any, meetings as any), rows };
}

describe('MeetingNotesService', () => {
  it('guarda notas con minuto y tipo, y las lista en orden de tiempo', async () => {
    const t = make();
    await t.svc.create(1, { offsetSec: 1452, kind: 'TAREA', text: ' Enviar casos ' }, 9);
    await t.svc.create(1, { offsetSec: 792, kind: 'ACUERDO', text: 'Reporte por cartera' }, 9);
    expect((await t.svc.list(1)).map((n) => [n.offsetSec, n.kind, n.text, n.createdByUserId])).toEqual([
      [792, 'ACUERDO', 'Reporte por cartera', 9],
      [1452, 'TAREA', 'Enviar casos', 9],
    ]);
  });

  it('texto vacío, tipo inválido o minuto negativo: 400', async () => {
    const t = make();
    await expect(t.svc.create(1, { offsetSec: 10, kind: 'NOTA', text: '  ' }, 9)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.create(1, { offsetSec: 10, kind: 'OTRO' as any, text: 'x' }, 9)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.create(1, { offsetSec: -1, kind: 'NOTA', text: 'x' }, 9)).rejects.toMatchObject({ status: 400 });
  });

  it('reunión inexistente: 404', async () => {
    const t = make();
    await expect(t.svc.create(99, { offsetSec: 1, kind: 'NOTA', text: 'x' }, 9)).rejects.toMatchObject({ status: 404 });
  });

  it('se puede quitar una nota', async () => {
    const t = make();
    const n = await t.svc.create(1, { offsetSec: 5, kind: 'NOTA', text: 'x' }, 9);
    await t.svc.remove(n.id);
    expect(await t.svc.list(1)).toEqual([]);
  });
});
