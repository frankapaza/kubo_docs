import {
  INVITATION_SECRET_BYTES,
  INVITATION_TTL_DAYS,
  fingerprintInvitationSecret,
  generateInvitationSecret,
  invitationExpiryFrom,
  isInvitationExpired,
} from './invitation-secret';

describe('el secreto de la invitación', () => {
  it('son 32 bytes aleatorios codificados para viajar en una URL', () => {
    expect(INVITATION_SECRET_BYTES).toBe(32);
    const secreto = generateInvitationSecret();
    // base64url de 32 bytes: 43 caracteres, y ninguno de los tres que
    // obligarían a escapar el enlace (`+`, `/`, `=`).
    expect(secreto).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('no es adivinable: mil secretos seguidos son mil valores distintos', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i += 1) vistos.add(generateInvitationSecret());
    expect(vistos.size).toBe(1000);
  });

  /**
   * La prueba que de verdad importa de este bloque. Un identificador
   * secuencial, una marca de tiempo o un id con formato adivinable dan
   * secretos con prefijos comunes; 32 bytes de fuente criptográfica, no.
   */
  it('dos secretos consecutivos no comparten ni el primer carácter de forma sistemática', () => {
    const primeros = new Set<string>();
    for (let i = 0; i < 200; i += 1) primeros.add(generateInvitationSecret()[0]);
    expect(primeros.size).toBeGreaterThan(10);
  });
});

describe('la huella', () => {
  it('es un SHA-256 en hexadecimal: 64 caracteres, todo [0-9a-f]', () => {
    expect(fingerprintInvitationSecret('lo-que-sea')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('es determinista: el mismo secreto da siempre la misma huella', () => {
    const secreto = generateInvitationSecret();
    expect(fingerprintInvitationSecret(secreto)).toBe(fingerprintInvitationSecret(secreto));
  });

  it('no contiene el secreto: es lo único que permite guardarla sin guardarlo', () => {
    const secreto = generateInvitationSecret();
    const huella = fingerprintInvitationSecret(secreto);
    expect(huella).not.toContain(secreto);
    expect(huella).not.toBe(secreto);
  });

  it('secretos distintos dan huellas distintas', () => {
    expect(fingerprintInvitationSecret('a')).not.toBe(fingerprintInvitationSecret('b'));
  });
});

describe('la caducidad', () => {
  it('son 7 días exactos contados en milisegundos desde el instante dado', () => {
    expect(INVITATION_TTL_DAYS).toBe(7);
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(invitationExpiryFrom(ahora).toISOString()).toBe('2026-09-02T15:00:00.000Z');
  });

  /**
   * El fallo que ya ha mordido seis veces en estos proyectos. Producción corre
   * en UTC y el host de desarrollo en América/Lima (UTC-5). Una caducidad
   * calculada con `setDate`/`getFullYear` -que leen la zona del proceso- cae en
   * un instante distinto según dónde corra, y encima cruza el cambio de día
   * justo en el tramo horario en que más se usa el portal.
   *
   * Se comprueba con un instante que en Lima es el día ANTERIOR: si el cálculo
   * pasara por una fecha civil, el resultado saldría desplazado.
   */
  it('se calcula sobre el instante absoluto, no sobre la fecha civil del proceso', () => {
    // 02:30 UTC del 27 = 21:30 del 26 en Lima. Dos días civiles distintos.
    const ahora = new Date('2026-08-27T02:30:00.000Z');
    expect(invitationExpiryFrom(ahora).getTime()).toBe(
      ahora.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it('una invitación cuyo instante de caducidad ya pasó está caducada', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired(new Date('2026-08-26T14:59:59.999Z'), ahora)).toBe(true);
  });

  it('el instante exacto de caducidad ya no sirve', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired(new Date('2026-08-26T15:00:00.000Z'), ahora)).toBe(true);
  });

  it('una invitación con caducidad futura no está caducada', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired(new Date('2026-08-26T15:00:00.001Z'), ahora)).toBe(false);
  });

  /**
   * TypeORM hidrata `DATETIME` como `Date`, pero un driver o un doble de
   * prueba puede devolver la cadena. Se admiten las dos formas, y las dos
   * tienen que dar el mismo veredicto.
   */
  it('acepta la caducidad como cadena y decide igual que con un Date', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired('2026-08-26T14:00:00.000Z', ahora)).toBe(true);
    expect(isInvitationExpired('2026-08-27T14:00:00.000Z', ahora)).toBe(false);
  });

  /**
   * Fallo cerrado. Una caducidad que no se puede interpretar NO puede
   * significar "todavía sirve": eso es decidir por la ausencia de un valor en
   * vez de por el hecho que lo determina, el defecto recurrente del proyecto.
   */
  it.each([['', 'cadena vacía'], ['no-es-una-fecha', 'basura']])(
    'una caducidad ilegible (%s, %s) se trata como caducada',
    (valor) => {
      expect(isInvitationExpired(valor, new Date('2026-08-26T15:00:00.000Z'))).toBe(true);
    },
  );
});
