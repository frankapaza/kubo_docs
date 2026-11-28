import { ActaSignaturesService, MAX_SIGNATURE_PNG_BYTES } from './acta-signatures.service';

/** PNG mínimo válido (1x1) en data URL. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function make(o: { status?: string; participants?: any[]; signed?: any[] } = {}) {
  const participants: any[] = o.participants ?? [
    { id: 5, meetingId: 1, fullName: 'Frank Apaza', documentNumber: '40000012', role: 'Jefe de proyecto', attended: 1, userId: 9 },
  ];
  const sigs: any[] = o.signed ?? [];
  const svc = new ActaSignaturesService(
    {
      findOne: jest.fn(async ({ where }: any) => sigs.find((s) => s.actaId === where.actaId && s.participantId === where.participantId) ?? null),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => { x.id = sigs.length + 1; sigs.push(x); return x; }),
    } as any,
    { findOne: jest.fn(async () => ({ id: 3, meetingId: 1, version: 2, status: o.status ?? 'IN_REVIEW', contentMarkdown: '# Acta' })) } as any,
    {
      findOne: jest.fn(async ({ where }: any) => participants.find((p) => p.id === where.id) ?? null),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => { x.id = 100 + participants.length; participants.push(x); return x; }),
    } as any,
    { findOne: jest.fn(async () => null) } as any,
    { send: jest.fn() } as any,
    { get: jest.fn(() => '') } as any,
  );
  return { svc, sigs, participants };
}

const OPERADOR = { id: 9, email: 'frank@kuboti.com', role: 'ADMIN' } as any;

describe('ActaSignaturesService.signInPerson (firma en el iPad)', () => {
  it('un asistente sin usuario firma con nombre, DNI y trazo: se crea como participante que asistió', async () => {
    const t = make();
    const sig = await t.svc.signInPerson(3, { signerName: ' Ana Pérez ', signerDocument: '45678912', signerRole: 'Área usuaria', signaturePng: PNG_1X1 }, OPERADOR, '10.0.0.1');
    expect(t.participants.at(-1)).toMatchObject({ meetingId: 1, fullName: 'Ana Pérez', documentNumber: '45678912', role: 'Área usuaria', attended: 1, userId: null });
    expect(sig).toMatchObject({ actaId: 3, method: 'IN_PERSON', signerName: 'Ana Pérez', signerDocument: '45678912', signedByUser: 9, ipAddress: '10.0.0.1' });
    expect(Buffer.isBuffer(sig.signaturePng)).toBe(true);
    expect(sig.signaturePng!.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(sig.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('un participante ya registrado firma en el iPad con su propio trazo', async () => {
    const t = make();
    const sig = await t.svc.signInPerson(3, { participantId: 5, signaturePng: PNG_1X1 }, OPERADOR, null);
    expect(sig).toMatchObject({ participantId: 5, signerName: 'Frank Apaza', signerDocument: '40000012', method: 'IN_PERSON' });
  });

  it('no firma dos veces el mismo participante', async () => {
    const t = make({ signed: [{ actaId: 3, participantId: 5 }] });
    await expect(t.svc.signInPerson(3, { participantId: 5, signaturePng: PNG_1X1 }, OPERADOR, null)).rejects.toMatchObject({ status: 400 });
  });

  it('exige el trazo, que sea PNG y de tamaño razonable', async () => {
    const t = make();
    const base = { signerName: 'Ana', signerDocument: '45678912' };
    await expect(t.svc.signInPerson(3, { ...base, signaturePng: '' }, OPERADOR, null)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.signInPerson(3, { ...base, signaturePng: 'data:image/png;base64,' + Buffer.from('hola').toString('base64') }, OPERADOR, null)).rejects.toMatchObject({ status: 400 });
    const grande = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(MAX_SIGNATURE_PNG_BYTES)]).toString('base64');
    await expect(t.svc.signInPerson(3, { ...base, signaturePng: grande }, OPERADOR, null)).rejects.toMatchObject({ status: 400 });
  });

  it('sin participante exige nombre y DNI', async () => {
    const t = make();
    await expect(t.svc.signInPerson(3, { signerName: 'Ana', signaturePng: PNG_1X1 }, OPERADOR, null)).rejects.toMatchObject({ status: 400 });
    await expect(t.svc.signInPerson(3, { signerDocument: '45678912', signaturePng: PNG_1X1 }, OPERADOR, null)).rejects.toMatchObject({ status: 400 });
  });

  it('un acta en borrador no se firma', async () => {
    const t = make({ status: 'DRAFT' });
    await expect(t.svc.signInPerson(3, { participantId: 5, signaturePng: PNG_1X1 }, OPERADOR, null)).rejects.toMatchObject({ status: 400 });
  });
});
