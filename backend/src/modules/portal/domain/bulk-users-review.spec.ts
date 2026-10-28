import {
  REVIEW_TTL_MS,
  REVIEW_VERSION,
  decodeReview,
  deriveReviewKey,
  encodeReview,
  isReviewExpired,
  reviewExpiryLabel,
  reviewMac,
  reviewMacMatches,
} from './bulk-users-review';

const CLAVE = deriveReviewKey('un-secreto-de-pruebas');

const PAYLOAD = {
  v: REVIEW_VERSION,
  clientId: 7,
  issuedAt: 1_757_000_000_000,
  rows: [{ line: 2, fullName: 'Ana Pérez', email: 'ana@x.com' }],
};

describe('el bloque firmado', () => {
  it('va y vuelve entero', () => {
    expect(decodeReview(encodeReview(PAYLOAD))).toEqual(PAYLOAD);
  });

  it('el MAC se calcula sobre LA CADENA, así que un bloque cambiado ya no casa', () => {
    const blob = encodeReview(PAYLOAD);
    const otro = encodeReview({
      ...PAYLOAD,
      rows: [{ line: 2, fullName: 'Ana Pérez', email: 'mia@x.com' }],
    });
    expect(reviewMacMatches(reviewMac(CLAVE, blob), reviewMac(CLAVE, otro))).toBe(false);
  });

  it('con otra clave no casa: la firma no la puede fabricar quien manda el bloque', () => {
    const blob = encodeReview(PAYLOAD);
    expect(
      reviewMacMatches(reviewMac(CLAVE, blob), reviewMac(deriveReviewKey('otro-secreto'), blob)),
    ).toBe(false);
  });

  it('la empresa va DENTRO del bloque firmado', () => {
    const blob = encodeReview(PAYLOAD);
    expect(decodeReview(blob)!.clientId).toBe(7);
    expect(
      reviewMacMatches(
        reviewMac(CLAVE, blob),
        reviewMac(CLAVE, encodeReview({ ...PAYLOAD, clientId: 8 })),
      ),
    ).toBe(false);
  });

  it('la clave se DERIVA del secreto, no es el secreto', () => {
    expect(deriveReviewKey('x')).toHaveLength(32);
    expect(deriveReviewKey('x').toString('utf8')).not.toBe('x');
  });

  it('sin secreto no hay clave: una clave vacía firmaría con algo que cualquiera conoce', () => {
    expect(() => deriveReviewKey('')).toThrow();
    expect(() => deriveReviewKey(undefined as unknown as string)).toThrow();
  });

  it('comparar no revienta con longitudes distintas', () => {
    expect(reviewMacMatches('abc', 'abc')).toBe(true);
    expect(reviewMacMatches('abc', 'abcd')).toBe(false);
    expect(reviewMacMatches('', '')).toBe(true);
  });

  it('comparar no revienta con lo que no es texto: falla cerrado', () => {
    const mac = reviewMac(CLAVE, encodeReview(PAYLOAD));
    expect(reviewMacMatches(mac, undefined as unknown as string)).toBe(false);
    expect(reviewMacMatches(mac, null as unknown as string)).toBe(false);
    expect(reviewMacMatches(mac, 123 as unknown as string)).toBe(false);
    expect(reviewMacMatches(mac, {} as unknown as string)).toBe(false);
  });

  it('una firma ausente o vacía nunca casa con un MAC real', () => {
    const mac = reviewMac(CLAVE, encodeReview(PAYLOAD));
    expect(mac).toHaveLength(64);
    expect(reviewMacMatches(mac, '')).toBe(false);
    expect(reviewMacMatches('', mac)).toBe(false);
  });
});

describe('decodeReview — todo lo que no tenga EXACTAMENTE la forma es null', () => {
  it.each([
    ['basura que no decodifica a JSON', Buffer.from('no soy json').toString('base64url')],
    ['JSON que no es un objeto', Buffer.from('[1,2,3]').toString('base64url')],
    ['versión desconocida', encodeReview({ ...PAYLOAD, v: 99 })],
    ['sin empresa', encodeReview({ ...PAYLOAD, clientId: 0 })],
    ['sin filas', encodeReview({ ...PAYLOAD, rows: [] })],
    [
      'una fila sin correo',
      encodeReview({ ...PAYLOAD, rows: [{ line: 2, fullName: 'A', email: '' }] }),
    ],
    [
      'issuedAt que no es número',
      encodeReview({ ...PAYLOAD, issuedAt: 'ayer' as unknown as number }),
    ],
    ['cadena vacía', ''],
  ])('%s → null', (_caso, blob) => {
    expect(decodeReview(blob)).toBeNull();
  });

  it('un valor que no es cadena → null, sin lanzar', () => {
    expect(decodeReview(undefined as unknown as string)).toBeNull();
    expect(decodeReview(null as unknown as string)).toBeNull();
  });
});

describe('isReviewExpired — instantes absolutos, nunca la zona del proceso', () => {
  // Todos los instantes son NÚMEROS de época construidos a mano. Ni una sola
  // cadena de fecha: `Date.parse` de una cadena sin desfase explícito la
  // interpreta en la zona del proceso, que es justo lo que esta prueba no
  // puede permitirse hacer.
  const emitida = 1_757_000_000_000;

  it('recién emitida, vale', () => {
    expect(isReviewExpired(emitida, new Date(emitida + 1_000))).toBe(false);
  });

  it('un milisegundo antes de cumplirse el plazo, vale', () => {
    expect(isReviewExpired(emitida, new Date(emitida + REVIEW_TTL_MS - 1))).toBe(false);
  });

  it('en el instante exacto del plazo ya NO vale: en la frontera gana la respuesta que no hace nada', () => {
    expect(isReviewExpired(emitida, new Date(emitida + REVIEW_TTL_MS))).toBe(true);
  });

  it('una emisión ilegible cuenta como caducada — falla cerrado', () => {
    expect(isReviewExpired(Number.NaN, new Date(emitida))).toBe(true);
    expect(isReviewExpired('ayer', new Date(emitida))).toBe(true);
    expect(isReviewExpired(null, new Date(emitida))).toBe(true);
  });

  it('un reloj ilegible cuenta como caducada: que no se pueda leer la hora no abre puertas', () => {
    expect(isReviewExpired(emitida, new Date(Number.NaN))).toBe(true);
  });

  it('una emisión en el futuro cuenta como caducada: un reloj movido no estira el plazo', () => {
    expect(isReviewExpired(emitida + 60_000, new Date(emitida))).toBe(true);
  });
});

describe('reviewExpiryLabel', () => {
  /**
   * Instante fijo construido con `Date.UTC`: la revisión caduca el 2026-09-09
   * a las 20:45Z, que en Lima (UTC-5) son las 15:45.
   *
   * Esta aserción es la que caza que alguien quite el `timeZone` del
   * formateador. `jest.config.js` fuerza `TZ=UTC`, así que un formateador sin
   * zona imprimiría 20:45 y la prueba fallaría. Funciona GRACIAS a `TZ=UTC`,
   * no a pesar de él.
   */
  it('imprime la hora de Lima, no la del proceso', () => {
    const emitida = Date.UTC(2026, 8, 9, 20, 45, 0) - REVIEW_TTL_MS;
    const etiqueta = reviewExpiryLabel(emitida);
    expect(etiqueta).toContain('15:45');
    expect(etiqueta).not.toContain('20:45');
  });

  it('la medianoche de Lima se escribe 00:xx, nunca 24:xx', () => {
    // 05:10Z = 00:10 en Lima.
    const emitida = Date.UTC(2026, 8, 10, 5, 10, 0) - REVIEW_TTL_MS;
    expect(reviewExpiryLabel(emitida)).toContain('00:10');
  });
});
