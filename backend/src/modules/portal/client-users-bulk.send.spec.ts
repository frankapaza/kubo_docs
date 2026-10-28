import { ConfigService } from '@nestjs/config';

import { ClientUsersBulkService } from './client-users-bulk.service';
// El módulo entero, además de sus nombres sueltos: es lo que permite espiar
// `decodeReview` y ver si el envío llega a llamarlo.
import * as revisionModule from './domain/bulk-users-review';
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
  /**
   * Correos cuya escritura lanza algo que NO es un `Error` y cuyo `.message`
   * revienta al leerlo. Nada en el código de arriba obliga a que lo lanzado sea
   * un `Error`, y el `catch` de cada fila existe para que una mala no tumbe la
   * tanda: si ese mismo `catch` revienta, se pierde el informe entero.
   */
  escriturasQueLanzanBasura: Set<string>;
}

function mundo(parcial: Partial<Mundo> = {}): Mundo {
  return {
    usuarios: [],
    invitacionesVivas: [],
    clientes: [{ id: 7, razonSocial: 'ACME S.A.C.', status: 'CLIENT' }],
    invitadas: [],
    correosQueFallan: new Set(),
    escriturasQueRevientan: new Set(),
    escriturasQueLanzanBasura: new Set(),
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
      if (m.escriturasQueLanzanBasura.has(dto.email)) {
        throw {
          get message(): string {
            throw new Error('y hasta leerte el motivo revienta');
          },
        };
      }
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
    await expect(crearServicio(mundo()).send(40, 7, { ...b, mac: 'f'.repeat(64) })).rejects.toThrow(
      /revisión/i,
    );
  });

  it('un bloque cambiado con su MAC viejo no pasa', async () => {
    const b = bloque([ANA]);
    const otro = bloque([{ ...ANA, email: 'mia@x.com' }]);
    await expect(
      crearServicio(mundo()).send(40, 7, { revision: otro.revision, mac: b.mac }),
    ).rejects.toThrow(/revisión/i);
  });

  it('una revisión de hace 31 minutos ya no vale', async () => {
    const b = bloque([ANA], { issuedAt: Date.now() - REVIEW_TTL_MS - 1 });
    await expect(crearServicio(mundo()).send(40, 7, b)).rejects.toThrow(/revisión/i);
  });

  it('la empresa sale del bloque firmado: el cuerpo no la trae y no hay dónde ponerla', async () => {
    const m = mundo({ clientes: [{ id: 9, razonSocial: 'OTRA', status: 'CLIENT' }] });
    // El bloque dice empresa 7, que en este mundo no existe: la lectura falla,
    // y no hay ningún `clientId` en el cuerpo que pudiera apuntar a la 9.
    await expect(crearServicio(m).send(40, 7, bloque([ANA]))).rejects.toThrow();
    expect(m.invitadas).toHaveLength(0);
  });
});

describe('send — invitar', () => {
  it('invita con autor de PERSONAL y en el orden del archivo, una a una', async () => {
    const m = mundo();
    const r = await crearServicio(m).send(40, 7, bloque([ANA, BEA]));

    expect(m.invitadas).toEqual([
      { clientId: 7, author: { kind: 'STAFF', userId: 40 }, email: 'ana@x.com' },
      { clientId: 7, author: { kind: 'STAFF', userId: 40 }, email: 'bea@x.com' },
    ]);
    expect(r.totals).toEqual({ invited: 2, invitedWithoutEmail: 0, skipped: 0, failed: 0 });
  });

  it('si el correo no sale, la invitación queda igual y se dice — no se calla', async () => {
    const m = mundo({ correosQueFallan: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, 7, bloque([ANA, BEA]));

    expect(r.rows.map((f) => f.outcome)).toEqual(['INVITADA', 'INVITADA_SIN_CORREO']);
    expect(r.rows[1].reason).toMatch(/no llegó a salir/i);
    expect(r.totals).toEqual({ invited: 1, invitedWithoutEmail: 1, skipped: 0, failed: 0 });
  });

  it('una fila que revienta al escribir NO tumba las buenas', async () => {
    const CHE = { line: 4, fullName: 'Che Lópe', email: 'che@x.com' };
    const m = mundo({ escriturasQueRevientan: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, 7, bloque([ANA, BEA, CHE]));

    expect(r.rows.map((f) => f.outcome)).toEqual(['INVITADA', 'FALLO', 'INVITADA']);
    expect(r.totals).toEqual({ invited: 2, invitedWithoutEmail: 0, skipped: 0, failed: 1 });
    // Y el motivo técnico NO sale en la respuesta: es diagnóstico interno.
    expect(r.rows[1].reason).not.toMatch(/la base se cayó/);
  });

  it('una fila que lanza algo que NO es un Error tampoco tumba la tanda', async () => {
    const CHE = { line: 4, fullName: 'Che Lópe', email: 'che@x.com' };
    const m = mundo({ escriturasQueLanzanBasura: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, 7, bloque([ANA, BEA, CHE]));

    // Lo que se prueba es que ESTO devuelve algo: con `(err as Error).message`
    // el propio `catch` reventaba al leer el motivo y se perdía el informe de
    // las filas ya invitadas.
    expect(r.rows.map((f) => f.outcome)).toEqual(['INVITADA', 'FALLO', 'INVITADA']);
    expect(m.invitadas.map((i) => i.email)).toEqual(['ana@x.com', 'che@x.com']);
  });

  it('los cuatro contadores suman siempre el total de filas', async () => {
    const m = mundo({ correosQueFallan: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, 7, bloque([ANA, BEA]));
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
    const r = await crearServicio(m).send(40, 7, bloque([ANA, BEA]));

    expect(r.rows[0].outcome).toBe('OMITIDA');
    expect(r.rows[0].reason).toMatch(/ya es usuario/i);
    expect(m.invitadas.map((i) => i.email)).toEqual(['bea@x.com']);
  });

  it('si la empresa pasó a ex-cliente entre los dos pasos, no sale ni un correo', async () => {
    const m = mundo({ clientes: [{ id: 7, razonSocial: 'ACME', status: 'FORMER_CLIENT' }] });
    await expect(crearServicio(m).send(40, 7, bloque([ANA, BEA]))).rejects.toThrow(
      /dejó de ser cliente/i,
    );
    expect(m.invitadas).toHaveLength(0);
  });
});

/**
 * Este informe **se copia del panel y se le manda a la empresa**, igual que el
 * de la revisión. Así que sus motivos se escriben para quien lo recibe —que no
 * tiene panel ni archivo— y no para el operador.
 */
describe('send — los motivos están escritos para quien recibe el informe', () => {
  const motivosDe = (r: { rows: { reason: string | null }[] }) =>
    r.rows.map((f) => f.reason).filter((x): x is string => x !== null);

  it('ninguno manda hacer algo que solo el operador puede hacer', async () => {
    const CHE = { line: 4, fullName: 'Che Lópe', email: 'che@x.com' };
    const m = mundo({
      correosQueFallan: new Set(['ana@x.com']),
      escriturasQueRevientan: new Set(['bea@x.com']),
      invitacionesVivas: [{ clientId: 7, email: 'che@x.com', createdAt: new Date() }],
    });
    const r = await crearServicio(m).send(40, 7, bloque([ANA, BEA, CHE]));

    expect(r.rows.map((f) => f.outcome)).toEqual([
      'INVITADA_SIN_CORREO',
      'FALLO',
      'OMITIDA',
    ]);
    expect(motivosDe(r)).toHaveLength(3);
    // «Vuelve a subir esta fila» era lo que decían tres de ellos, y es algo que
    // quien recibe el informe no puede hacer: no tiene panel. Nombrar el
    // archivo para contar qué pasó sí vale —es el archivo que él mandó—; lo
    // que no vale es mandarle subirlo.
    for (const motivo of motivosDe(r)) {
      expect(motivo).not.toMatch(/vuelve a subir|vuelva a subir|desde el panel/i);
    }
  });

  it('el de la fila omitida dice lo que consta y no adivina por qué', async () => {
    const m = mundo({
      invitacionesVivas: [{ clientId: 7, email: 'ana@x.com', createdAt: new Date() }],
    });
    const r = await crearServicio(m).send(40, 7, bloque([ANA]));

    expect(r.rows[0].outcome).toBe('OMITIDA');
    // El hecho: hay una invitación suya posterior a la revisión.
    expect(r.rows[0].reason).toMatch(/después de revisarse el archivo/i);
    // La conjetura que estaba y no estaba en condiciones de afirmar: en el caso
    // frecuente la mandó otra persona, y entonces era falsa.
    expect(r.rows[0].reason).not.toMatch(/puede que|quizá|seguramente/i);
  });
});

describe('send — el secreto de la invitación no sube', () => {
  it('en la respuesta no aparece nada con la forma de un secreto de invitación', async () => {
    const r = await crearServicio(mundo()).send(40, 7, bloque([ANA, BEA]));
    // 43 caracteres del alfabeto base64url: la forma de un secreto. Se busca
    // la FORMA y no una clave concreta, para que la prueba no se quede vieja
    // el día que alguien añada un campo.
    expect(JSON.stringify(r)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});

describe('send — el orden de las comprobaciones', () => {
  /**
   * Esta prueba fija que los dos motivos —firma mala y forma mala— dicen lo
   * mismo, que es una propiedad real y deseada. Lo que NO fija es el ORDEN:
   * los dos cuerpos son idénticos en los dos órdenes, así que invertirlos la
   * dejaría en verde. De eso se encarga la siguiente.
   */
  it('la firma mala y la forma mala responden exactamente lo mismo', async () => {
    const basura = 'esto-no-es-un-bloque';
    // Firma correcta de basura: pasa la firma, y se rechaza por forma, con el mismo cuerpo.
    const firmada = { revision: basura, mac: reviewMac(CLAVE, basura) };
    const e1 = await crearServicio(mundo()).send(40, 7, firmada).catch((e) => e);
    const e2 = await crearServicio(mundo())
      .send(40, 7, { revision: basura, mac: 'a'.repeat(64) })
      .catch((e) => e);
    expect(e1.getResponse()).toEqual(e2.getResponse());
    expect(e1.getResponse().code).toBe('REVISION_NO_VALIDA');
  });

  /**
   * **El orden, anclado donde se puede ver: en lo que se llama.**
   *
   * La regla es verificar la firma ANTES de decodificar nada, y las dos formas
   * de romperla —firmar después de decodificar, y decodificar más caducidad
   * antes de la firma— sobrevivían a toda la suite porque el cuerpo del error
   * es el mismo en los tres órdenes. Lo único que las distingue es si el
   * decodificador llega a tocar una cadena que no hemos firmado nosotros.
   *
   * El bloque va **bien formado a propósito**: si fuera basura, una inversión
   * también acabaría en el mismo error y la prueba volvería a ser una
   * tautología. Aquí lo único que falla es la firma.
   */
  it('con la firma mala NO se decodifica nada: el decodificador no llega a llamarse', async () => {
    const espia = jest.spyOn(revisionModule, 'decodeReview');
    try {
      const b = bloque([ANA]);
      await expect(
        crearServicio(mundo()).send(40, 7, { revision: b.revision, mac: 'a'.repeat(64) }),
      ).rejects.toThrow(/revisión/i);
      expect(espia).not.toHaveBeenCalled();
    } finally {
      espia.mockRestore();
    }
  });

  it('un bloque con la firma de otro secreto no pasa', async () => {
    const b = bloque([ANA]);
    const ajena = reviewMac(deriveReviewKey('otro-secreto'), b.revision);
    await expect(crearServicio(mundo()).send(40, 7, { ...b, mac: ajena })).rejects.toThrow(/revisión/i);
  });

  it('una revisión emitida en el futuro no vale', async () => {
    const b = bloque([ANA], { issuedAt: Date.now() + 60_000 });
    await expect(crearServicio(mundo()).send(40, 7, b)).rejects.toThrow(/revisión/i);
  });
});

describe('send — repetir la confirmación no duplica nada', () => {
  it('confirmar dos veces el mismo bloque: la segunda no invita ni manda nada', async () => {
    const m = mundo();
    const s = crearServicio(m);
    const b = bloque([ANA, BEA]);

    const primera = await s.send(40, 7, b);
    const segunda = await s.send(40, 7, b);

    expect(primera.totals.invited).toBe(2);
    expect(m.invitadas).toHaveLength(2);
    expect(segunda.rows.map((f) => f.outcome)).toEqual(['OMITIDA', 'OMITIDA']);
    expect(segunda.rows[0].reason).toMatch(/ya se le había mandado/i);
  });

  /**
   * El hueco de verdad, y el que las dos pruebas de arriba NO cubrían: las dos
   * usan correos nuevos, que salen de la revisión con una invitación viva y por
   * tanto como `SE_REINVITARA` en la segunda vuelta. Una persona DESACTIVADA
   * sale como `SE_INVITARA` —esa rama se resuelve antes de mirar las
   * invitaciones—, así que con la guarda metida dentro del `if` de la
   * reinvitación no se le consultaba nunca: cada confirmación repetida le
   * mandaba un enlace nuevo y mataba el anterior.
   */
  it('una persona DESACTIVADA, con el mismo bloque confirmado dos veces: un solo correo', async () => {
    const m = mundo({
      usuarios: [{ id: 1, clientId: 7, email: 'ana@x.com', isActive: 0, isAdmin: 0 }],
    });
    const s = crearServicio(m);
    const b = bloque([ANA]);

    const primera = await s.send(40, 7, b);
    const segunda = await s.send(40, 7, b);

    expect(primera.rows[0].outcome).toBe('INVITADA');
    expect(segunda.rows[0].outcome).toBe('OMITIDA');
    expect(segunda.rows[0].reason).toMatch(/ya se le había mandado/i);
    // Lo medido: un solo envío, no dos.
    expect(m.invitadas).toHaveLength(1);
  });

  it('y su primera fila lleva el aviso de que recupera su acceso, que la revisión sí daba', async () => {
    const m = mundo({
      usuarios: [{ id: 1, clientId: 7, email: 'ana@x.com', isActive: 0, isAdmin: 0 }],
    });
    const r = await crearServicio(m).send(40, 7, bloque([ANA]));
    expect(r.rows[0].outcome).toBe('INVITADA');
    expect(r.rows[0].reason).toMatch(/recuperará su acceso y su historial/i);
  });

  it('una fila corriente sigue saliendo sin motivo: no hay nada que explicar', async () => {
    const r = await crearServicio(mundo()).send(40, 7, bloque([ANA]));
    expect(r.rows[0]).toEqual({ ...ANA, outcome: 'INVITADA', reason: null });
  });

  it('un reintento tras una caída a medias solo manda lo que faltaba', async () => {
    const m = mundo({ escriturasQueRevientan: new Set(['bea@x.com']) });
    const s = crearServicio(m);
    const b = bloque([ANA, BEA]);

    await s.send(40, 7, b);
    m.escriturasQueRevientan.clear();
    const r = await s.send(40, 7, b);

    expect(r.rows.map((f) => f.outcome)).toEqual(['OMITIDA', 'INVITADA']);
    expect(m.invitadas.map((i) => i.email)).toEqual(['ana@x.com', 'bea@x.com']);
  });

  it('una invitación pendiente ANTERIOR a la revisión sí se reemplaza: es lo que la revisión anunció', async () => {
    const m = mundo({
      invitacionesVivas: [
        { clientId: 7, email: 'ana@x.com', createdAt: new Date(Date.now() - 3_600_000) },
      ],
    });
    const r = await crearServicio(m).send(40, 7, bloque([ANA]));
    expect(r.rows[0].outcome).toBe('INVITADA');
  });

  it('dos confirmaciones SIMULTÁNEAS del mismo bloque: la segunda se rechaza entera', async () => {
    let soltar!: () => void;
    const m = mundo({ pausa: new Promise<void>((r) => (soltar = r)) });
    const s = crearServicio(m);
    const b = bloque([ANA]);

    const primera = s.send(40, 7, b);
    await new Promise((r) => setImmediate(r));
    await expect(s.send(40, 7, b)).rejects.toThrow(/ya se está enviando/i);

    soltar();
    await primera;
    expect(m.invitadas).toHaveLength(1);
  });

  it('el cerrojo se suelta aunque el envío reviente: se puede reintentar', async () => {
    const m = mundo({ clientes: [{ id: 7, razonSocial: 'ACME', status: 'FORMER_CLIENT' }] });
    const s = crearServicio(m);
    const b = bloque([ANA]);
    await expect(s.send(40, 7, b)).rejects.toThrow(/dejó de ser cliente/i);
    m.clientes[0].status = 'CLIENT';
    expect((await s.send(40, 7, b)).totals.invited).toBe(1);
  });
});
