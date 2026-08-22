import { normalizeMessageId } from './message-id';

describe('normalizeMessageId', () => {
  it('un Message-ID ASCII se guarda tal cual, sin tocarlo', () => {
    expect(normalizeMessageId('<abc123@servidor.com>')).toBe('<abc123@servidor.com>');
  });

  it('la cadena vacía es ASCII (vacuamente) y se devuelve tal cual', () => {
    // `message_id` no admite NULL; una cadena vacía real algún día tiene que
    // poder guardarse sin disfrazarse de hash.
    expect(normalizeMessageId('')).toBe('');
  });

  it('un Message-ID no-ASCII (RFC 6532) se sustituye por un hash con prefijo reconocible', () => {
    const resultado = normalizeMessageId('<pedído-123@ejemplo.com>');

    expect(resultado.startsWith('sha256:')).toBe(true);
    // El hash en sí (sin el prefijo) es un sha256 en hexadecimal: 64 caracteres, todo [0-9a-f].
    expect(resultado.slice('sha256:'.length)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el sustituto es puro ASCII: cabe en una columna CHARACTER SET ascii', () => {
    const resultado = normalizeMessageId('<pedído-123@ejemplo.com>');

    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(resultado)).toBe(true);
  });

  it('es determinista: el mismo valor crudo da siempre el mismo sustituto', () => {
    const raw = '<pedído-123@ejemplo.com>';

    expect(normalizeMessageId(raw)).toBe(normalizeMessageId(raw));
  });

  it('esa determinación es lo que sostiene la idempotencia: reinsertar el mismo correo no-ASCII tras un reinicio a medias choca contra la misma clave única', () => {
    // No es una prueba distinta a la anterior; es su porqué, dejado explícito
    // en la especificación en vez de solo en el comentario del código.
    const primeraPasada = normalizeMessageId('<réplica@cliente.com>');
    const reinicioAMedias = normalizeMessageId('<réplica@cliente.com>');

    expect(primeraPasada).toBe(reinicioAMedias);
  });

  it('remitentes distintos (no-ASCII) dan sustitutos distintos: no colapsa la deduplicación entre correos diferentes', () => {
    const a = normalizeMessageId('<uno-ñ@x.com>');
    const b = normalizeMessageId('<dos-ñ@x.com>');

    expect(a).not.toBe(b);
  });

  it('un carácter fuera de ASCII en cualquier posición (no solo al principio) activa la sustitución', () => {
    // Un Message-ID largo y ASCII salvo por un único carácter al final es
    // exactamente la clase de valor que un bucle mal escrito ("empieza por
    // ASCII, listo") dejaría pasar sin normalizar.
    const casiAscii = `<${'a'.repeat(50)}ñ@x.com>`;

    expect(normalizeMessageId(casiAscii).startsWith('sha256:')).toBe(true);
  });
});
