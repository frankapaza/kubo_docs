import {
  ALLOWED_TYPES,
  assertAcceptable,
  detectMimeType,
  MAX_FILE_BYTES,
  MAX_TICKET_BYTES,
} from './attachment-rules';

// --- Constructores de ficheros de prueba -----------------------------------
//
// Cada constructor produce los bytes REALES de la firma de ese formato -- no
// un mock ni una cadena de texto que "parece" el formato. Es justo lo que
// hace único a este módulo: si aquí se hiciera trampa con la firma, el test
// central (bytes de otra cosa con extensión de imagen) dejaría de decir nada.

function pngBytes(): Buffer {
  // 89 50 4E 47 0D 0A 1A 0A -- firma completa de 8 bytes, más un IHDR
  // cualquiera detrás para que se parezca a un PNG real (no hace falta que
  // sea válido más allá de la firma: detectMimeType no mira más que eso).
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  ]);
}

function jpegBytes(): Buffer {
  // FF D8 FF -- SOI + inicio del primer marcador. Todo JPEG empieza así,
  // independientemente del marcador que venga después (JFIF, EXIF, ...).
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

function webpBytes(): Buffer {
  // "RIFF" (0-3) + tamaño de fichero en 4 bytes (4-7, variable, aquí 0x24
  // arbitrario) + "WEBP" (8-11) + "VP8 " (chunk). RIFF y WEBP son DOS tramos
  // separados por ese campo de tamaño -- no son contiguos.
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from('VP8 ', 'ascii'),
  ]);
}

function gif87aBytes(): Buffer {
  return Buffer.concat([Buffer.from('GIF87a', 'ascii'), Buffer.from([0x0a, 0x00, 0x0a, 0x00])]);
}

function gif89aBytes(): Buffer {
  return Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([0x0a, 0x00, 0x0a, 0x00])]);
}

function pdfBytes(): Buffer {
  // "%PDF-" + versión. La especificación exige esta cabecera al inicio del fichero.
  return Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
}

function svgBytes(): Buffer {
  // Texto plano, no binario: es exactamente lo que hace peligroso al SVG.
  // Ni siquiera hace falta el <script> para que no case ninguna firma, pero
  // se incluye porque es la razón real de excluirlo.
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf-8');
}

function randomBinaryBytes(length = 64): Buffer {
  // Ni imagen, ni PDF, ni texto: la cabecera de un ejecutable cualquiera
  // (MZ, la firma de un .exe de Windows) rellenada con ruido.
  const buf = Buffer.alloc(length, 0);
  buf[0] = 0x4d; // 'M'
  buf[1] = 0x5a; // 'Z'
  for (let i = 2; i < length; i++) buf[i] = i % 256;
  return buf;
}

const VALID_NAME = 'captura.png';
const VALID_MIME = 'image/png';

describe('ALLOWED_TYPES -- la lista corta', () => {
  it('contiene exactamente los cinco tipos aceptados, y ningún SVG', () => {
    expect([...ALLOWED_TYPES].sort()).toEqual(
      ['application/pdf', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'].sort(),
    );
    expect(ALLOWED_TYPES).not.toContain('image/svg+xml');
  });
});

describe('detectMimeType -- por la firma de bytes, no por metadatos', () => {
  it('detecta PNG por su firma de 8 bytes', () => {
    expect(detectMimeType(pngBytes())).toBe('image/png');
  });

  it('detecta JPEG por FF D8 FF', () => {
    expect(detectMimeType(jpegBytes())).toBe('image/jpeg');
  });

  it('detecta WebP por "RIFF" ... "WEBP" en dos tramos separados por el tamaño', () => {
    expect(detectMimeType(webpBytes())).toBe('image/webp');
  });

  it('un RIFF que no es WEBP (otro contenedor RIFF cualquiera) no se detecta como imagen', () => {
    const notWebp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('AVI ', 'ascii'),
    ]);
    expect(detectMimeType(notWebp)).toBeNull();
  });

  it('detecta GIF87a', () => {
    expect(detectMimeType(gif87aBytes())).toBe('image/gif');
  });

  it('detecta GIF89a', () => {
    expect(detectMimeType(gif89aBytes())).toBe('image/gif');
  });

  it('detecta PDF por "%PDF-"', () => {
    expect(detectMimeType(pdfBytes())).toBe('application/pdf');
  });

  it('un SVG no se detecta como ningún tipo permitido: es texto XML, no una firma binaria', () => {
    expect(detectMimeType(svgBytes())).toBeNull();
  });

  it('unos bytes que no casan con ninguna firma devuelven null', () => {
    expect(detectMimeType(randomBinaryBytes())).toBeNull();
  });

  it('un buffer vacío no revienta: devuelve null', () => {
    expect(detectMimeType(Buffer.alloc(0))).toBeNull();
  });

  it.each([
    ['PNG', pngBytes()],
    ['JPEG', jpegBytes()],
    ['WebP', webpBytes()],
    ['GIF', gif89aBytes()],
    ['PDF', pdfBytes()],
  ])('un fichero %s truncado antes de completar su firma no revienta: devuelve null', (_label, full) => {
    // Un byte menos que la firma mínima de cada formato.
    const truncated = full.subarray(0, 1);
    expect(() => detectMimeType(truncated)).not.toThrow();
    expect(detectMimeType(truncated)).toBeNull();
  });

  it('documenta el límite del chequeo por firma: unos bytes de PNG válidos seguidos de HTML se siguen detectando como PNG', () => {
    // Esto es intencional y no es un bug de este módulo: la firma solo mira
    // la cabecera. Un polígloto PNG/HTML pasa este filtro igual que pasaría
    // el de cualquier verificador de firma. La barrera que existe para este
    // caso es la segunda del diseño (descarga forzada + nosniff), que vive
    // en el controlador de descarga, no aquí.
    const polyglot = Buffer.concat([pngBytes(), Buffer.from('<script>alert(1)</script>', 'utf-8')]);
    expect(detectMimeType(polyglot)).toBe('image/png');
  });
});

describe('assertAcceptable -- el test central', () => {
  it('un PNG real, con nombre y tipo declarado coherentes, se acepta', () => {
    const result = assertAcceptable({
      buffer: pngBytes(),
      declaredMime: VALID_MIME,
      filename: VALID_NAME,
      size: pngBytes().length,
    });
    expect(result.mimeType).toBe('image/png');
    expect(result.originalName).toBe(VALID_NAME);
  });

  it('un fichero con extensión .png y tipo declarado image/png pero bytes de un ejecutable se rechaza', () => {
    const buffer = randomBinaryBytes();
    expect(() =>
      assertAcceptable({
        buffer,
        declaredMime: 'image/png',
        filename: 'captura.png',
        size: buffer.length,
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'BAD_INPUT' }),
      }),
    );
  });

  it('el rechazo por firma no depende de qué diga la extensión o el mime declarado: mismos bytes, mismo resultado con cualquier disfraz', () => {
    const buffer = randomBinaryBytes();
    const disguises = [
      { declaredMime: 'image/png', filename: 'captura.png' },
      { declaredMime: 'application/pdf', filename: 'factura.pdf' },
      { declaredMime: 'image/jpeg', filename: 'foto.jpg' },
    ];
    for (const disguise of disguises) {
      expect(() =>
        assertAcceptable({ buffer, size: buffer.length, ...disguise }),
      ).toThrow();
    }
  });

  it('un SVG anunciado como imagen se rechaza', () => {
    const buffer = svgBytes();
    expect(() =>
      assertAcceptable({
        buffer,
        declaredMime: 'image/svg+xml',
        filename: 'logo.svg',
        size: buffer.length,
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'BAD_INPUT' }),
      }),
    );
  });

  it('un fichero vacío se rechaza sin reventar', () => {
    expect(() =>
      assertAcceptable({ buffer: Buffer.alloc(0), declaredMime: 'image/png', filename: 'vacio.png', size: 0 }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'BAD_INPUT' }),
      }),
    );
  });

  it('un fichero más corto que cualquier firma se rechaza sin reventar', () => {
    const buffer = Buffer.from([0x89, 0x50]);
    expect(() =>
      assertAcceptable({ buffer, declaredMime: 'image/png', filename: 'corto.png', size: buffer.length }),
    ).toThrow();
  });

  it('un fichero que supera MAX_FILE_BYTES se rechaza, y el mensaje da el límite en MB, no en bytes', () => {
    const buffer = pngBytes();
    let caught: unknown;
    try {
      assertAcceptable({
        buffer,
        declaredMime: 'image/png',
        filename: 'enorme.png',
        size: MAX_FILE_BYTES + 1,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const response = (caught as { response: { code: string; message: string } }).response;
    expect(response.code).toBe('BAD_INPUT');
    expect(response.message).toMatch(/MB/);
    expect(response.message).not.toMatch(/\d{6,}/); // nada de una cifra en bytes crudos
  });

  it('un fichero justo en el límite se acepta (el límite es inclusivo)', () => {
    const buffer = pngBytes();
    const result = assertAcceptable({
      buffer,
      declaredMime: 'image/png',
      filename: 'justo.png',
      size: MAX_FILE_BYTES,
    });
    expect(result.mimeType).toBe('image/png');
  });

  it('el nombre original se conserva tal cual, sin sanear -- con mayúsculas, espacios y tildes', () => {
    const buffer = pngBytes();
    const rawName = ' Captura de pantalla (áéí) #1.PNG ';
    const result = assertAcceptable({ buffer, declaredMime: 'image/png', filename: rawName, size: buffer.length });
    expect(result.originalName).toBe(rawName);
  });

  it('el resultado nunca expone el nombre como clave: no hay ninguna propiedad "key" ni derivada del nombre', () => {
    const buffer = pngBytes();
    const result = assertAcceptable({
      buffer,
      declaredMime: 'image/png',
      filename: '../../etc/passwd.png',
      size: buffer.length,
    });
    expect(Object.keys(result).sort()).toEqual(['mimeType', 'originalName', 'size'].sort());
    expect((result as unknown as Record<string, unknown>).key).toBeUndefined();
    // El nombre peligroso se conserva tal cual como dato para mostrar...
    expect(result.originalName).toBe('../../etc/passwd.png');
    // ...pero detectMimeType nunca lo recibe ni lo necesita: la detección ya
    // ocurrió solo con `buffer`, sin que `filename` participe en la decisión.
  });

  it('el nombre de fichero nunca decide el tipo detectado: un PDF real con extensión .png se acepta como PDF, no se rechaza por la extensión', () => {
    const buffer = pdfBytes();
    const result = assertAcceptable({
      buffer,
      declaredMime: 'image/png',
      filename: 'esto-dice-que-es-png.png',
      size: buffer.length,
    });
    expect(result.mimeType).toBe('application/pdf');
  });
});

describe('MAX_TICKET_BYTES -- presupuesto por ticket', () => {
  it('es mayor que MAX_FILE_BYTES: un ticket admite más de un adjunto', () => {
    expect(MAX_TICKET_BYTES).toBeGreaterThan(MAX_FILE_BYTES);
  });
});
