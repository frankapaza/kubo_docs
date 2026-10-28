import { ConfigService } from '@nestjs/config';

import { ClientUsersBulkService } from './client-users-bulk.service';
import {
  REVIEW_TTL_MS,
  REVIEW_VERSION,
  deriveReviewKey,
  encodeReview,
  reviewMac,
} from './domain/bulk-users-review';

const SECRETO = 'secreto-de-pruebas';
const CLAVE = deriveReviewKey(SECRETO);

interface Mundo {
  usuarios: { id: number; clientId: number; email: string; isActive: number; isAdmin: number }[];
  invitacionesVivas: { clientId: number; email: string; createdAt?: Date }[];
  /** Si está, cada alta tarda esto en resolverse: para probar la doble pulsación. */
  pausa?: Promise<void>;
  clientes: { id: number; razonSocial: string; status: string }[];
  /** Cada llamada a invitar, en orden. Es lo que prueba que van en serie. */
  invitadas: { clientId: number; author: unknown; email: string }[];
  /** Correos que el transporte rechaza. Ver `deliveryFailed`. */
  correosQueFallan: Set<string>;
  /** Correos cuya escritura revienta, para probar que una fila mala no tumba las buenas. */
  escriturasQueRevientan: Set<string>;
}

function mundo(parcial: Partial<Mundo> = {}): Mundo {
  return {
    usuarios: [],
    invitacionesVivas: [],
    clientes: [{ id: 7, razonSocial: 'ACME S.A.C.', status: 'CLIENT' }],
    invitadas: [],
    correosQueFallan: new Set(),
    escriturasQueRevientan: new Set(),
    ...parcial,
  };
}

function crearServicio(m: Mundo) {
  const clientUsers = {
    findByEmail: async (email: string) => m.usuarios.find((u) => u.email === email) ?? null,
  };
  const invitations = {
    findLiveByEmail: async (email: string) =>
      m.invitacionesVivas.find((i) => i.email === email) ?? null,
  };
  const clients = {
    findByIdOrFail: async (id: number) => {
      const c = m.clientes.find((x) => x.id === id);
      if (!c) throw new Error('no existe');
      return c;
    },
  };
  const portalInvitations = {
    invite: async (clientId: number, author: unknown, dto: { email: string; fullName: string }) => {
      if (m.escriturasQueRevientan.has(dto.email)) throw new Error('la base se cayó');
      if (m.pausa) await m.pausa;
      m.invitadas.push({ clientId, author, email: dto.email });
      // Como la real: revoca la viva anterior y deja una nueva, creada ahora.
      m.invitacionesVivas = m.invitacionesVivas.filter((i) => i.email !== dto.email);
      m.invitacionesVivas.push({ clientId, email: dto.email, createdAt: new Date() });
      return {
        id: m.invitadas.length,
        fullName: dto.fullName,
        email: dto.email,
        expiresAt: '2026-09-16T00:00:00.000Z',
        lastSentAt: '2026-09-09T00:00:00.000Z',
        deliveryFailed: m.correosQueFallan.has(dto.email),
        createdAt: '2026-09-09T00:00:00.000Z',
      };
    },
  };

  return new ClientUsersBulkService(
    clientUsers as never,
    invitations as never,
    clients as never,
    portalInvitations as never,
    new ConfigService({ JWT_ACCESS_SECRET: SECRETO }),
  );
}

function bloque(
  filas: { line: number; fullName: string; email: string }[],
  opciones: { clientId?: number; issuedAt?: number } = {},
) {
  const revision = encodeReview({
    v: REVIEW_VERSION,
    clientId: opciones.clientId ?? 7,
    issuedAt: opciones.issuedAt ?? Date.now(),
    rows: filas,
  });
  return { revision, mac: reviewMac(CLAVE, revision) };
}

const ANA = { line: 2, fullName: 'Ana Pérez', email: 'ana@x.com' };
const BEA = { line: 3, fullName: 'Bea Ruiz', email: 'bea@x.com' };

describe('send — la correspondencia con lo revisado', () => {
  it('un MAC cambiado no pasa', async () => {
    const b = bloque([ANA]);
    await expect(crearServicio(mundo()).send(40, { ...b, mac: 'f'.repeat(64) })).rejects.toThrow(
      /revisión/i,
    );
  });

  it('un bloque cambiado con su MAC viejo no pasa', async () => {
    const b = bloque([ANA]);
    const otro = bloque([{ ...ANA, email: 'mia@x.com' }]);
    await expect(
      crearServicio(mundo()).send(40, { revision: otro.revision, mac: b.mac }),
    ).rejects.toThrow(/revisión/i);
  });

  it('una revisión de hace 31 minutos ya no vale', async () => {
    const b = bloque([ANA], { issuedAt: Date.now() - REVIEW_TTL_MS - 1 });
    await expect(crearServicio(mundo()).send(40, b)).rejects.toThrow(/revisión/i);
  });

  it('la empresa sale del bloque firmado: el cuerpo no la trae y no hay dónde ponerla', async () => {
    const m = mundo({ clientes: [{ id: 9, razonSocial: 'OTRA', status: 'CLIENT' }] });
    // El bloque dice empresa 7, que en este mundo no existe: la lectura falla,
    // y no hay ningún `clientId` en el cuerpo que pudiera apuntar a la 9.
    await expect(crearServicio(m).send(40, bloque([ANA]))).rejects.toThrow();
    expect(m.invitadas).toHaveLength(0);
  });
});

describe('send — invitar', () => {
  it('invita con autor de PERSONAL y en el orden del archivo, una a una', async () => {
    const m = mundo();
    const r = await crearServicio(m).send(40, bloque([ANA, BEA]));

    expect(m.invitadas).toEqual([
      { clientId: 7, author: { kind: 'STAFF', userId: 40 }, email: 'ana@x.com' },
      { clientId: 7, author: { kind: 'STAFF', userId: 40 }, email: 'bea@x.com' },
    ]);
    expect(r.totals).toEqual({ invited: 2, invitedWithoutEmail: 0, skipped: 0, failed: 0 });
  });

  it('si el correo no sale, la invitación queda igual y se dice — no se calla', async () => {
    const m = mundo({ correosQueFallan: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, bloque([ANA, BEA]));

    expect(r.rows.map((f) => f.outcome)).toEqual(['INVITADA', 'INVITADA_SIN_CORREO']);
    expect(r.rows[1].reason).toMatch(/vuelve a subir/i);
    expect(r.totals).toEqual({ invited: 1, invitedWithoutEmail: 1, skipped: 0, failed: 0 });
  });

  it('una fila que revienta al escribir NO tumba las buenas', async () => {
    const CHE = { line: 4, fullName: 'Che Lópe', email: 'che@x.com' };
    const m = mundo({ escriturasQueRevientan: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, bloque([ANA, BEA, CHE]));

    expect(r.rows.map((f) => f.outcome)).toEqual(['INVITADA', 'FALLO', 'INVITADA']);
    expect(r.totals).toEqual({ invited: 2, invitedWithoutEmail: 0, skipped: 0, failed: 1 });
    // Y el motivo técnico NO sale en la respuesta: es diagnóstico interno.
    expect(r.rows[1].reason).not.toMatch(/la base se cayó/);
  });

  it('los cuatro contadores suman siempre el total de filas', async () => {
    const m = mundo({ correosQueFallan: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, bloque([ANA, BEA]));
    const { invited, invitedWithoutEmail, skipped, failed } = r.totals;
    expect(invited + invitedWithoutEmail + skipped + failed).toBe(r.rows.length);
  });
});

describe('send — el mundo pudo cambiar entre la revisión y la confirmación', () => {
  it('una fila que ya no se puede invitar sale OMITIDA con su motivo, y NO se invita', async () => {
    // Entre los dos pasos, alguien dio de alta a Ana desde el panel.
    const m = mundo({
      usuarios: [{ id: 1, clientId: 7, email: 'ana@x.com', isActive: 1, isAdmin: 0 }],
    });
    const r = await crearServicio(m).send(40, bloque([ANA, BEA]));

    expect(r.rows[0].outcome).toBe('OMITIDA');
    expect(r.rows[0].reason).toMatch(/ya es usuario/i);
    expect(m.invitadas.map((i) => i.email)).toEqual(['bea@x.com']);
  });

  it('si la empresa pasó a ex-cliente entre los dos pasos, no sale ni un correo', async () => {
    const m = mundo({ clientes: [{ id: 7, razonSocial: 'ACME', status: 'FORMER_CLIENT' }] });
    await expect(crearServicio(m).send(40, bloque([ANA, BEA]))).rejects.toThrow(
      /dejó de ser cliente/i,
    );
    expect(m.invitadas).toHaveLength(0);
  });
});

describe('send — el secreto de la invitación no sube', () => {
  it('en la respuesta no aparece nada con la forma de un secreto de invitación', async () => {
    const r = await crearServicio(mundo()).send(40, bloque([ANA, BEA]));
    // 43 caracteres del alfabeto base64url: la forma de un secreto. Se busca
    // la FORMA y no una clave concreta, para que la prueba no se quede vieja
    // el día que alguien añada un campo.
    expect(JSON.stringify(r)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});

describe('send — el orden de las comprobaciones', () => {
  it('con la firma mala no se decodifica nada: ni una cadena que no es un bloque llega a interpretarse', async () => {
    const basura = 'esto-no-es-un-bloque';
    // Firma correcta de basura: pasa la firma, y se rechaza por forma, con el mismo cuerpo.
    const firmada = { revision: basura, mac: reviewMac(CLAVE, basura) };
    const e1 = await crearServicio(mundo()).send(40, firmada).catch((e) => e);
    const e2 = await crearServicio(mundo())
      .send(40, { revision: basura, mac: 'a'.repeat(64) })
      .catch((e) => e);
    expect(e1.getResponse()).toEqual(e2.getResponse());
    expect(e1.getResponse().code).toBe('REVISION_NO_VALIDA');
  });

  it('un bloque con la firma de otro secreto no pasa', async () => {
    const b = bloque([ANA]);
    const ajena = reviewMac(deriveReviewKey('otro-secreto'), b.revision);
    await expect(crearServicio(mundo()).send(40, { ...b, mac: ajena })).rejects.toThrow(/revisión/i);
  });

  it('una revisión emitida en el futuro no vale', async () => {
    const b = bloque([ANA], { issuedAt: Date.now() + 60_000 });
    await expect(crearServicio(mundo()).send(40, b)).rejects.toThrow(/revisión/i);
  });
});

describe('send — repetir la confirmación no duplica nada', () => {
  it('confirmar dos veces el mismo bloque: la segunda no invita ni manda nada', async () => {
    const m = mundo();
    const s = crearServicio(m);
    const b = bloque([ANA, BEA]);

    const primera = await s.send(40, b);
    const segunda = await s.send(40, b);

    expect(primera.totals.invited).toBe(2);
    expect(m.invitadas).toHaveLength(2);
    expect(segunda.rows.map((f) => f.outcome)).toEqual(['OMITIDA', 'OMITIDA']);
    expect(segunda.rows[0].reason).toMatch(/ya se le mandó/i);
  });

  it('un reintento tras una caída a medias solo manda lo que faltaba', async () => {
    const m = mundo({ escriturasQueRevientan: new Set(['bea@x.com']) });
    const s = crearServicio(m);
    const b = bloque([ANA, BEA]);

    await s.send(40, b);
    m.escriturasQueRevientan.clear();
    const r = await s.send(40, b);

    expect(r.rows.map((f) => f.outcome)).toEqual(['OMITIDA', 'INVITADA']);
    expect(m.invitadas.map((i) => i.email)).toEqual(['ana@x.com', 'bea@x.com']);
  });

  it('una invitación pendiente ANTERIOR a la revisión sí se reemplaza: es lo que la revisión anunció', async () => {
    const m = mundo({
      invitacionesVivas: [
        { clientId: 7, email: 'ana@x.com', createdAt: new Date(Date.now() - 3_600_000) },
      ],
    });
    const r = await crearServicio(m).send(40, bloque([ANA]));
    expect(r.rows[0].outcome).toBe('INVITADA');
  });

  it('dos confirmaciones SIMULTÁNEAS del mismo bloque: la segunda se rechaza entera', async () => {
    let soltar!: () => void;
    const m = mundo({ pausa: new Promise<void>((r) => (soltar = r)) });
    const s = crearServicio(m);
    const b = bloque([ANA]);

    const primera = s.send(40, b);
    await new Promise((r) => setImmediate(r));
    await expect(s.send(40, b)).rejects.toThrow(/ya se está enviando/i);

    soltar();
    await primera;
    expect(m.invitadas).toHaveLength(1);
  });

  it('el cerrojo se suelta aunque el envío reviente: se puede reintentar', async () => {
    const m = mundo({ clientes: [{ id: 7, razonSocial: 'ACME', status: 'FORMER_CLIENT' }] });
    const s = crearServicio(m);
    const b = bloque([ANA]);
    await expect(s.send(40, b)).rejects.toThrow(/dejó de ser cliente/i);
    m.clientes[0].status = 'CLIENT';
    expect((await s.send(40, b)).totals.invited).toBe(1);
  });
});
