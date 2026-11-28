import { createHash } from 'crypto';

import { ActaSignaturesService, isSignatureComplete } from './acta-signatures.service';

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const OPERADOR = { id: 9, email: 'frank@kuboti.com', role: 'ADMIN' } as any;

function make() {
  const participants: any[] = [
    { id: 5, meetingId: 1, fullName: 'Ana Pérez', documentNumber: '45678912', email: 'ana@cliente.pe', role: 'Área usuaria', attended: 1, userId: null },
    { id: 6, meetingId: 1, fullName: 'Luis Soto', documentNumber: '41111111', email: null, role: null, attended: 1, userId: null },
  ];
  const sigs: any[] = [];
  const sent: any[] = [];
  const sigRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      sigs.find((s) => Object.entries(where).every(([k, v]) => s[k] === v)) ?? null),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => { if (!x.id) { x.id = sigs.length + 1; sigs.push(x); } return x; }),
  };
  const svc = new ActaSignaturesService(
    sigRepo as any,
    { findOne: jest.fn(async () => ({ id: 3, meetingId: 1, version: 2, status: 'IN_REVIEW', contentMarkdown: '# Acta' })) } as any,
    {
      findOne: jest.fn(async ({ where }: any) => participants.find((p) => p.id === where.id) ?? null),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => { x.id = 100 + participants.length; participants.push(x); return x; }),
    } as any,
    { findOne: jest.fn(async () => ({ id: 1, title: 'Reunión de avance COB', scheduledAt: new Date('2026-11-28T15:00:00Z') })) } as any,
    { send: jest.fn(async (m: any) => { sent.push(m); return {}; }) } as any,
    { get: jest.fn(() => 'https://docs.kuboti.com') } as any,
  );
  return { svc, sigs, sent, participants };
}

const tokenFrom = (html: string) => /firmar-acta\/([A-Za-z0-9_-]+)/.exec(html)![1];

describe('Firma por confirmación de correo', () => {
  it('EMAIL: crea la firma pendiente y envía un enlace; al confirmar queda completa', async () => {
    const t = make();
    const sig = await t.svc.requestByEmail(3, { participantId: 5, mode: 'EMAIL' }, OPERADOR, null);
    expect(sig).toMatchObject({ method: 'EMAIL', confirmEmail: 'ana@cliente.pe', emailConfirmedAt: null });
    expect(isSignatureComplete(sig)).toBe(false);
    expect(t.sent[0].to).toBe('ana@cliente.pe');
    expect(t.sent[0].subject).toContain('Reunión de avance COB');
    const token = tokenFrom(t.sent[0].html);
    expect(sig.confirmTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(sig)).not.toContain(token);

    expect(await t.svc.previewByToken(token)).toMatchObject({ signerName: 'Ana Pérez', meetingTitle: 'Reunión de avance COB', status: 'PENDIENTE' });
    const done = await t.svc.confirmByToken(token, '10.0.0.9');
    expect(done.emailConfirmedAt).toBeInstanceOf(Date);
    expect(done.confirmTokenHash).toBeNull();
    expect(isSignatureComplete(done)).toBe(true);
  });

  it('BOTH: exige el trazo; completa solo cuando también confirma por correo', async () => {
    const t = make();
    await expect(t.svc.requestByEmail(3, { participantId: 5, mode: 'BOTH' }, OPERADOR, null)).rejects.toMatchObject({ status: 400 });
    const sig = await t.svc.requestByEmail(3, { participantId: 5, mode: 'BOTH', signaturePng: PNG_1X1 }, OPERADOR, null);
    expect(sig.method).toBe('BOTH');
    expect(Buffer.isBuffer(sig.signaturePng)).toBe(true);
    expect(isSignatureComplete(sig)).toBe(false);
    const done = await t.svc.confirmByToken(tokenFrom(t.sent[0].html), null);
    expect(isSignatureComplete(done)).toBe(true);
  });

  it('sin correo del participante, se puede indicar en el momento; sin ninguno, 400', async () => {
    const t = make();
    await expect(t.svc.requestByEmail(3, { participantId: 6, mode: 'EMAIL' }, OPERADOR, null)).rejects.toMatchObject({ status: 400 });
    const sig = await t.svc.requestByEmail(3, { participantId: 6, mode: 'EMAIL', signerEmail: 'luis@cliente.pe' }, OPERADOR, null);
    expect(sig.confirmEmail).toBe('luis@cliente.pe');
  });

  it('un enlace usado, vencido o inventado no confirma', async () => {
    const t = make();
    await t.svc.requestByEmail(3, { participantId: 5, mode: 'EMAIL' }, OPERADOR, null);
    const token = tokenFrom(t.sent[0].html);
    await t.svc.confirmByToken(token, null);
    await expect(t.svc.confirmByToken(token, null)).rejects.toMatchObject({ status: 404 });
    await expect(t.svc.confirmByToken('x'.repeat(43), null)).rejects.toMatchObject({ status: 404 });

    const t2 = make();
    const s2 = await t2.svc.requestByEmail(3, { participantId: 5, mode: 'EMAIL' }, OPERADOR, null);
    s2.confirmExpiresAt = new Date(Date.now() - 1000);
    await expect(t2.svc.confirmByToken(tokenFrom(t2.sent[0].html), null)).rejects.toMatchObject({ status: 410 });
  });

  it('las firmas de antes (con usuario) y las dibujadas cuentan como completas', () => {
    expect(isSignatureComplete({ method: 'USER' } as any)).toBe(true);
    expect(isSignatureComplete({ method: 'IN_PERSON' } as any)).toBe(true);
  });
});
