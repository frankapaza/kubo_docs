import {
  MAX_EVENTS_PER_BATCH,
  MAX_LABEL_CHARS,
  MAX_PROPERTIES,
  MAX_PROPERTY_CHARS,
  MAX_TEXT_CHARS,
  parseIngestBatch,
  truncateText,
} from './ingest-batch';

const evento = (extra: Record<string, unknown> = {}) => ({
  ts: '2026-11-07T10:00:00Z',
  nivel: 'error',
  logger: 'GCC.BL.Pagos',
  mensaje: 'falló',
  ...extra,
});
const lote = (extra: Record<string, unknown> = {}) => ({
  aplicativo: 'GCC',
  servidor: 'SRV01',
  eventos: [evento()],
  ...extra,
});
function ok(raw: unknown) {
  const r = parseIngestBatch(raw);
  if (!r.ok) throw new Error('esperaba ok: ' + r.message);
  return r.batch;
}

describe('parseIngestBatch', () => {
  it('acepta un lote mínimo válido', () => {
    const b = ok(lote());
    expect(b).toMatchObject({
      loteId: null,
      aplicativo: 'GCC',
      servidor: 'SRV01',
      appenderVersion: null,
      descartados: 0,
    });
    expect(b.eventos[0]).toEqual({
      ts: '2026-11-07T10:00:00Z',
      nivel: 'ERROR',
      logger: 'GCC.BL.Pagos',
      mensaje: 'falló',
      excepcion: null,
      hilo: null,
      propiedades: {},
    });
  });

  it('ignora campos desconocidos', () => {
    expect(parseIngestBatch({ ...lote(), rareza: 1, eventos: [evento({ otro: 2 })] }).ok).toBe(true);
  });

  it('rechaza lo que no es objeto', () => {
    expect(parseIngestBatch(null).ok).toBe(false);
    expect(parseIngestBatch('x').ok).toBe(false);
  });

  it('rechaza si falta aplicativo, servidor o eventos no es arreglo', () => {
    expect(parseIngestBatch(lote({ aplicativo: undefined })).ok).toBe(false);
    expect(parseIngestBatch(lote({ servidor: '' })).ok).toBe(false);
    expect(parseIngestBatch(lote({ eventos: 'x' })).ok).toBe(false);
  });

  it('rechaza 1001 eventos y el mensaje menciona 1000', () => {
    const r = parseIngestBatch(
      lote({ eventos: Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => evento()) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('1000');
  });

  it('recorta mensaje y excepción a 32768', () => {
    const b = ok(lote({ eventos: [evento({ mensaje: 'a'.repeat(40000), excepcion: 'b'.repeat(40000) })] }));
    expect(b.eventos[0].mensaje).toHaveLength(MAX_TEXT_CHARS);
    expect(b.eventos[0].excepcion).toHaveLength(MAX_TEXT_CHARS);
  });

  it('quita controles y recorta aplicativo a 100', () => {
    const b = ok(lote({ aplicativo: 'GC\nC\r\t' + 'x'.repeat(150) }));
    expect(b.aplicativo).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(b.aplicativo).toHaveLength(MAX_LABEL_CHARS);
  });

  it('un aplicativo solo de controles cuenta como vacío', () => {
    expect(parseIngestBatch(lote({ aplicativo: '\n\r' })).ok).toBe(false);
  });

  it('recorta servidor a 100', () => {
    expect(ok(lote({ servidor: 's'.repeat(150) })).servidor).toHaveLength(MAX_LABEL_CHARS);
  });

  it('recorta logger a 255 y hilo a 100, sin controles', () => {
    const b = ok(
      lote({ eventos: [evento({ logger: 'l\no' + 'g'.repeat(300), hilo: 'h\n' + 'i'.repeat(200) })] }),
    );
    expect(b.eventos[0].logger).toHaveLength(255);
    expect(b.eventos[0].logger).not.toMatch(/[\u0000-\u001f]/);
    expect(b.eventos[0].hilo).toHaveLength(100);
    expect(b.eventos[0].hilo).not.toMatch(/[\u0000-\u001f]/);
  });

  it('limita a 50 propiedades', () => {
    const propiedades = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'v']));
    expect(
      Object.keys(ok(lote({ eventos: [evento({ propiedades })] })).eventos[0].propiedades),
    ).toHaveLength(MAX_PROPERTIES);
  });

  it('descarta objetos, convierte número/booleano a cadena y null a vacío', () => {
    const p = ok(
      lote({ eventos: [evento({ propiedades: { o: { a: 1 }, n: 5, b: true, z: null, arr: [1] } })] }),
    ).eventos[0].propiedades;
    expect(p).toEqual({ n: '5', b: 'true', z: '' });
  });

  it('recorta claves y valores de propiedades a 1024', () => {
    const p = ok(
      lote({ eventos: [evento({ propiedades: { ['k'.repeat(2000)]: 'v'.repeat(2000) } })] }),
    ).eventos[0].propiedades;
    const [k, v] = Object.entries(p)[0];
    expect(k).toHaveLength(MAX_PROPERTY_CHARS);
    expect(v).toHaveLength(MAX_PROPERTY_CHARS);
  });

  it('descartados negativo o no numérico es 0; loteId no cadena es null', () => {
    expect(ok(lote({ descartados: -3 })).descartados).toBe(0);
    expect(ok(lote({ descartados: 'x' })).descartados).toBe(0);
    expect(ok(lote({ descartados: 7 })).descartados).toBe(7);
    expect(ok(lote({ loteId: 12 })).loteId).toBeNull();
    expect(ok(lote({ loteId: 'abc' })).loteId).toBe('abc');
  });

  it('ignora elementos de eventos que no son objeto', () => {
    expect(ok(lote({ eventos: [evento(), 'basura', null] })).eventos).toHaveLength(1);
  });
});

describe('truncateText', () => {
  it('no toca lo corto y recorta lo largo', () => {
    expect(truncateText('abc', 5)).toBe('abc');
    expect(truncateText('abcdef', 3)).toBe('abc');
  });
});
