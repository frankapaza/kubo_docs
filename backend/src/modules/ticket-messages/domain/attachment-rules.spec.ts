import { ALLOWED_TYPES, assertAcceptable, detectMimeType, MAX_FILE_BYTES } from './attachment-rules';

// --- Constructores de ficheros de prueba -----------------------------------
//
// Cada constructor produce los bytes REALES de la firma de ese formato -- no
// un mock ni una cadena de texto que "parece" el formato. Es justo lo que
// hace único a este módulo: si aquí se hiciera trampa con la firma, el test
// central (bytes de otra cosa con extensión de imagen) dejaría de decir nada.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(): Buffer {
  // Firma completa de 8 bytes, más un IHDR cualquiera detrás para que se
  // parezca a un PNG real (no hace falta que sea válido más allá de la
  // firma: detectMimeType no mira más que eso).
  return Buffer.concat([Buffer.from(PNG_SIGNATURE), Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])]);
}

/** Un PNG cuyo tamaño TOTAL es exactamente `totalSize` bytes: firma real + relleno. */
function pngBytesOfSize(totalSize: number): Buffer {
  const buf = Buffer.alloc(totalSize, 0);
  Buffer.from(PNG_SIGNATURE).copy(buf, 0);
  return buf;
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

/** Helper: capta la excepción que lanza `assertAcceptable` y devuelve su `response`. */
function captureRejection(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (err) {
    return (err as { response: { code: string; message: string } }).response;
  }
  throw new Error('se esperaba que assertAcceptable rechazara, y no rechazó');
}

describe('ALLOWED_TYPES -- la lista corta, y de verdad conectada a la detección', () => {
  it('contiene exactamente los cinco tipos aceptados, y ningún SVG', () => {
    expect([...ALLOWED_TYPES].sort()).toEqual(
      ['application/pdf', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'].sort(),
    );
    expect(ALLOWED_TYPES).not.toContain('image/svg+xml');
  });

  it.each([
    ['PNG', pngBytes()],
    ['JPEG', jpegBytes()],
    ['WebP', webpBytes()],
    ['GIF87a', gif87aBytes()],
    ['GIF89a', gif89aBytes()],
    ['PDF', pdfBytes()],
  ])(
    'lo que detectMimeType devuelve para %s está siempre en ALLOWED_TYPES: no hay un tipo detectable que la lista no reconozca',
    (_label, buffer) => {
      const detected = detectMimeType(buffer);
      expect(detected).not.toBeNull();
      expect(ALLOWED_TYPES).toContain(detected);
    },
  );
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

  it('un RIFF que no es WEBP (otro contenedor RIFF cualquiera, p. ej. AVI) no se detecta como imagen', () => {
    const notWebp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('AVI ', 'ascii'),
    ]);
    expect(detectMimeType(notWebp)).toBeNull();
  });

  it('un RIFF truncado justo antes de llegar a la marca "WEBP" (offset 8) no se detecta: el segundo tramo nunca llega a comprobarse sobre datos completos', () => {
    // "RIFF" + 4 bytes de tamaño = 8 bytes exactos, sin ningún byte de "WEBP" detrás.
    const truncatedRiff = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0x24, 0x00, 0x00, 0x00])]);
    expect(truncatedRiff.length).toBe(8);
    expect(detectMimeType(truncatedRiff)).toBeNull();
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

  it('un PDF cuya firma no está en el byte 0 (desplazada por basura previa) no se detecta: la especificación la exige al inicio', () => {
    const shiftedPdf = Buffer.concat([Buffer.from([0x00, 0x00, 0x00]), pdfBytes()]);
    expect(detectMimeType(shiftedPdf)).toBeNull();
  });

  it.each([
    ['sin espacios', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['con espacios y salto de línea antes de la etiqueta', '   \n<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['con declaración XML delante', '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['en mayúsculas', '<SVG XMLNS="http://www.w3.org/2000/svg"><SCRIPT>alert(1)</SCRIPT></SVG>'],
    ['autocerrada, sin script visible', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
  ])(
    'un SVG no se detecta como ningún tipo permitido (variante: %s): es texto XML, no una firma binaria -- por ausencia en la lista blanca, no por una regla que lo prohíba explícitamente',
    (_label, xml) => {
      expect(detectMimeType(Buffer.from(xml, 'utf-8'))).toBeNull();
    },
  );

  it('un SVG con BOM UTF-8 delante tampoco se detecta', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf-8');
    expect(detectMimeType(Buffer.concat([bom, svg]))).toBeNull();
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
    const buffer = pngBytes();
    const result = assertAcceptable({
      buffer,
      declaredMime: VALID_MIME,
      filename: VALID_NAME,
      declaredSize: buffer.length,
    });
    expect(result.mimeType).toBe('image/png');
    expect(result.originalName).toBe(VALID_NAME);
    expect(result.size).toBe(buffer.length);
  });

  it('un fichero con extensión .png y tipo declarado image/png pero bytes de un ejecutable se rechaza, con código UNSUPPORTED_MEDIA_TYPE', () => {
    const buffer = randomBinaryBytes();
    const response = captureRejection(() =>
      assertAcceptable({
        buffer,
        declaredMime: 'image/png',
        filename: 'captura.png',
        declaredSize: buffer.length,
      }),
    );
    expect(response.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('el rechazo por firma no depende de qué diga la extensión o el mime declarado: mismos bytes, mismo resultado con cualquier disfraz', () => {
    const buffer = randomBinaryBytes();
    const disguises = [
      { declaredMime: 'image/png', filename: 'captura.png' },
      { declaredMime: 'application/pdf', filename: 'factura.pdf' },
      { declaredMime: 'image/jpeg', filename: 'foto.jpg' },
    ];
    for (const disguise of disguises) {
      expect(() => assertAcceptable({ buffer, declaredSize: buffer.length, ...disguise })).toThrow();
    }
  });

  it('un SVG anunciado como imagen se rechaza, con código UNSUPPORTED_MEDIA_TYPE', () => {
    const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf-8');
    const response = captureRejection(() =>
      assertAcceptable({
        buffer,
        declaredMime: 'image/svg+xml',
        filename: 'logo.svg',
        declaredSize: buffer.length,
      }),
    );
    expect(response.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('un fichero vacío se rechaza sin reventar, con código UNSUPPORTED_MEDIA_TYPE', () => {
    const response = captureRejection(() =>
      assertAcceptable({ buffer: Buffer.alloc(0), declaredMime: 'image/png', filename: 'vacio.png', declaredSize: 0 }),
    );
    expect(response.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('un fichero más corto que cualquier firma se rechaza sin reventar', () => {
    const buffer = Buffer.from([0x89, 0x50]);
    expect(() =>
      assertAcceptable({ buffer, declaredMime: 'image/png', filename: 'corto.png', declaredSize: buffer.length }),
    ).toThrow();
  });

  describe('el tamaño: buffer.length manda, no el declarado (ronda de corrección 1)', () => {
    it('un fichero que supera MAX_FILE_BYTES de verdad se rechaza, con código PAYLOAD_TOO_LARGE y el mensaje en MB', () => {
      const buffer = pngBytesOfSize(MAX_FILE_BYTES + 1);
      const response = captureRejection(() =>
        assertAcceptable({
          buffer,
          declaredMime: 'image/png',
          filename: 'enorme.png',
          declaredSize: buffer.length,
        }),
      );
      expect(response.code).toBe('PAYLOAD_TOO_LARGE');
      expect(response.message).toMatch(/MB/);
      expect(response.message).not.toMatch(/\d{6,}/); // nada de una cifra en bytes crudos
    });

    it('el mensaje de límite superado no es contradictorio: el tamaño mostrado y el máximo mostrado nunca son la misma cifra', () => {
      // Un byte por encima del máximo es el caso más habitual (el que se pasa
      // por poco) y el que antes producía «pesa 10 MB, máximo 10 MB».
      const buffer = pngBytesOfSize(MAX_FILE_BYTES + 1);
      const response = captureRejection(() =>
        assertAcceptable({ buffer, declaredMime: 'image/png', filename: 'enorme.png', declaredSize: buffer.length }),
      );
      const [, actualLabel] = response.message.match(/pesa ([\d.]+ MB)/) ?? [];
      const [, maxLabel] = response.message.match(/máximo permitido por archivo es ([\d.]+ MB)/) ?? [];
      expect(actualLabel).toBeDefined();
      expect(maxLabel).toBeDefined();
      expect(actualLabel).not.toBe(maxLabel);
    });

    it('un fichero justo en el límite (buffer.length === MAX_FILE_BYTES) se acepta: el límite es inclusivo', () => {
      const buffer = pngBytesOfSize(MAX_FILE_BYTES);
      const result = assertAcceptable({
        buffer,
        declaredMime: 'image/png',
        filename: 'justo.png',
        declaredSize: buffer.length,
      });
      expect(result.mimeType).toBe('image/png');
      expect(result.size).toBe(MAX_FILE_BYTES);
    });

    it('declaredSize: -1 no cuela un fichero que por buffer.length sí pesa de más, ni resta del acumulado: el tamaño devuelto es el real', () => {
      const buffer = pngBytesOfSize(MAX_FILE_BYTES + 1);
      const response = captureRejection(() =>
        assertAcceptable({ buffer, declaredMime: 'image/png', filename: 'miente.png', declaredSize: -1 }),
      );
      expect(response.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('declaredSize: NaN no evita el rechazo de un fichero que por buffer.length pesa de más', () => {
      const buffer = pngBytesOfSize(MAX_FILE_BYTES + 1);
      const response = captureRejection(() =>
        assertAcceptable({ buffer, declaredMime: 'image/png', filename: 'nan.png', declaredSize: NaN }),
      );
      expect(response.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('un buffer real de 20 MB declarando declaredSize: 10 igual se rechaza por tamaño: la autoridad es el contenido, no el dato declarado', () => {
      const twentyMb = 20 * 1024 * 1024;
      const buffer = pngBytesOfSize(twentyMb);
      const response = captureRejection(() =>
        assertAcceptable({ buffer, declaredMime: 'image/png', filename: 'subdeclarado.png', declaredSize: 10 }),
      );
      expect(response.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('el tamaño devuelto en el resultado aceptado es siempre buffer.length, nunca declaredSize', () => {
      const buffer = pngBytes();
      const result = assertAcceptable({
        buffer,
        declaredMime: 'image/png',
        filename: 'ok.png',
        declaredSize: 999999, // deliberadamente distinto del tamaño real
      });
      expect(result.size).toBe(buffer.length);
      expect(result.size).not.toBe(999999);
    });
  });

  it('el nombre original se conserva tal cual, sin sanear -- con mayúsculas, espacios y tildes', () => {
    const buffer = pngBytes();
    const rawName = ' Captura de pantalla (áéí) #1.PNG ';
    const result = assertAcceptable({
      buffer,
      declaredMime: 'image/png',
      filename: rawName,
      declaredSize: buffer.length,
    });
    expect(result.originalName).toBe(rawName);
  });

  it('el resultado nunca expone el nombre como clave: no hay ninguna propiedad "key" ni derivada del nombre', () => {
    const buffer = pngBytes();
    const result = assertAcceptable({
      buffer,
      declaredMime: 'image/png',
      filename: '../../etc/passwd.png',
      declaredSize: buffer.length,
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
      declaredSize: buffer.length,
    });
    expect(result.mimeType).toBe('application/pdf');
  });

  it('un filename y un declaredMime muy largos no inflan el mensaje de error sin límite', () => {
    const buffer = randomBinaryBytes();
    const longName = 'a'.repeat(500) + '.png';
    const longMime = 'x'.repeat(500);
    const response = captureRejection(() =>
      assertAcceptable({ buffer, declaredMime: longMime, filename: longName, declaredSize: buffer.length }),
    );
    expect(response.message.length).toBeLessThan(300);
  });

  it('un filename vacío tiene un respaldo legible en el mensaje, no una cadena vacía', () => {
    const buffer = randomBinaryBytes();
    const response = captureRejection(() =>
      assertAcceptable({ buffer, declaredMime: 'image/png', filename: '', declaredSize: buffer.length }),
    );
    expect(response.message).toMatch(/sin nombre/i);
  });
});

