import {
  COLUMNA_CORREO,
  COLUMNA_NOMBRE,
  BULK_UPLOAD_LIMITS,
  MAX_BULK_FILE_BYTES,
  MAX_BULK_ROWS,
  decodeTextFile,
  gridToRows,
  looksLikeZip,
  normalizeHeader,
  parseDelimitedText,
  sniffDelimiter,
} from './bulk-user-file';

const CABECERA = [COLUMNA_NOMBRE, COLUMNA_CORREO];

describe('normalizeHeader', () => {
  it('recorta, baja a minúsculas, colapsa espacios y quita tildes', () => {
    expect(normalizeHeader('  Correo   ELECTRÓNICO ')).toBe('correo electronico');
  });

  it('no revienta con lo que no es una cadena', () => {
    expect(normalizeHeader(undefined as unknown as string)).toBe('');
  });
});

describe('looksLikeZip', () => {
  it('reconoce la firma PK\\x03\\x04', () => {
    expect(looksLikeZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe(true);
  });

  it('un texto no es un ZIP por mucho que se llame .xlsx', () => {
    expect(looksLikeZip(Buffer.from('Nombre completo,Correo', 'utf8'))).toBe(false);
  });

  it('un buffer más corto que la firma no revienta', () => {
    expect(looksLikeZip(Buffer.from([0x50, 0x4b]))).toBe(false);
  });
});

describe('decodeTextFile', () => {
  it('se come la marca de orden de bytes y no la deja en el primer encabezado', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Nombre completo,Correo electrónico', 'utf8'),
    ]);
    expect(decodeTextFile(bytes).startsWith(COLUMNA_NOMBRE)).toBe(true);
  });

  it('lee UTF-8 cuando los bytes son UTF-8 válido', () => {
    expect(decodeTextFile(Buffer.from('Muñoz Peña', 'utf8'))).toBe('Muñoz Peña');
  });

  it('cae a windows-1252 cuando los bytes NO son UTF-8 válido — el Excel en español', () => {
    // `Muñoz` con la eñe en un solo byte (0xF1): lo que escribe Excel al
    // guardar «CSV (delimitado por comas)» en un Windows en español.
    expect(decodeTextFile(Buffer.from('Mu\xf1oz', 'latin1'))).toBe('Muñoz');
  });

  it('windows-1252: el apóstrofo y las comillas curvas de Excel no son caracteres de control', () => {
    // 0x92 apóstrofo tipográfico, 0x93/0x94 comillas curvas, 0x96 raya.
    const bytes = Buffer.from([0x44, 0x92, 0x41, 0x20, 0x93, 0x50, 0x94, 0x20, 0x96, 0x20, 0x50, 0xf1]);
    expect(decodeTextFile(bytes)).toBe('D\u2019A \u201cP\u201d \u2013 P\u00f1');
  });

  /**
   * La tabla de 0x80-0x9F recorrida ENTERA, con los valores esperados escritos
   * aquí aparte (de la tabla oficial de windows-1252), NO derivados del código:
   * si se derivaran de él, la prueba se estaría mirando a sí misma.
   */
  const CP1252_ESPERADO: Array<[number, number]> = [
    [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e],
    [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02c6],
    [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
    [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c],
    [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
    [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
    [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
  ];
  const CP1252_HUECOS = [0x81, 0x8d, 0x8f, 0x90, 0x9d];

  it.each(CP1252_ESPERADO)('windows-1252: el byte 0x%s se lee como el carácter que le toca', (byte, codePoint) => {
    // Un 0x80-0x9F suelto nunca es UTF-8 válido, así que siempre cae a windows-1252.
    expect(decodeTextFile(Buffer.from([0x41, byte, 0x41]))).toBe(`A${String.fromCodePoint(codePoint)}A`);
  });

  it.each(CP1252_HUECOS)('windows-1252: el byte 0x%s no tiene carácter y sigue siendo el control de latin1', (byte) => {
    expect(decodeTextFile(Buffer.from([0x41, byte, 0x41]))).toBe(`A${String.fromCharCode(byte)}A`);
  });

  it('windows-1252: los 32 bytes del tramo están cubiertos (27 con carácter y 5 huecos)', () => {
    expect(CP1252_ESPERADO.length + CP1252_HUECOS.length).toBe(32);
  });

  it('windows-1252: de 0xA0 a 0xFF coincide con latin1', () => {
    const bytes = Buffer.from(Array.from({ length: 0x60 }, (_, i) => 0xa0 + i));
    expect(decodeTextFile(Buffer.concat([Buffer.from('A'), bytes]))).toBe('A' + bytes.toString('latin1'));
  });

  it('un archivo de cero bytes dice que está vacío, no que falta el separador', () => {
    expect(() => decodeTextFile(Buffer.alloc(0))).toThrow(/vacío/i);
    expect(() => decodeTextFile(Buffer.from([0xef, 0xbb, 0xbf]))).toThrow(/vacío/i);
  });

  it('el «Texto Unicode» de Excel (UTF-16) se nombra, no habla de hojas de cálculo', () => {
    const bytes = Buffer.from('\ufeffNombre completo\tCorreo', 'utf16le');
    expect(() => decodeTextFile(bytes)).toThrow(/Unicode/);
    expect(() => decodeTextFile(bytes)).not.toThrow(/hoja de cálculo/);
  });

  it('un byte nulo bien entrado el archivo también lo descarta', () => {
    const bytes = Buffer.concat([
      Buffer.from('Nombre completo,Correo\n' + 'x'.repeat(500)),
      Buffer.from([0x00]),
      Buffer.from('fin'),
    ]);
    expect(() => decodeTextFile(bytes)).toThrow(/hoja de cálculo/i);
  });

  it('rechaza un binario disfrazado: un byte nulo no aparece en un archivo de texto', () => {
    expect(() => decodeTextFile(Buffer.from([0x41, 0x00, 0x42]))).toThrow(/hoja de cálculo/i);
  });
});

describe('sniffDelimiter', () => {
  it('coma', () => {
    expect(sniffDelimiter('Nombre completo,Correo electrónico')).toBe(',');
  });

  it('punto y coma — lo que escribe Excel en un Windows en español', () => {
    expect(sniffDelimiter('Nombre completo;Correo electrónico')).toBe(';');
  });

  it('tabulador', () => {
    expect(sniffDelimiter('Nombre completo\tCorreo electrónico')).toBe('\t');
  });

  it('no cuenta los separadores que van dentro de comillas', () => {
    // Una sola columna entrecomillada con comas dentro y un punto y coma de
    // verdad al final: gana el punto y coma, no la coma.
    expect(sniffDelimiter('"Pérez, Ana";Correo')).toBe(';');
  });

  it('solo mira la cabecera: las comas de los datos no le ganan al punto y coma', () => {
    const texto = 'Nombre completo;Correo electrónico\nA,B,C,D,E;a@x.com\nF,G,H,I;f@x.com';
    expect(parseDelimitedText(texto)).toEqual([
      ['Nombre completo', 'Correo electrónico'],
      ['A,B,C,D,E', 'a@x.com'],
      ['F,G,H,I', 'f@x.com'],
    ]);
  });

  it('sin ningún separador no hay dos columnas: se rechaza', () => {
    expect(() => sniffDelimiter('Nombre completo')).toThrow(/separador/i);
  });
});

describe('parseDelimitedText', () => {
  it('entiende comillas con el separador dentro y comillas dobles escapadas', () => {
    const texto = 'Nombre completo,Correo electrónico\r\n"Pérez, Ana",ana@x.com\r\n"Di ""Bo""",bo@x.com';
    expect(parseDelimitedText(texto)).toEqual([
      ['Nombre completo', 'Correo electrónico'],
      ['Pérez, Ana', 'ana@x.com'],
      ['Di "Bo"', 'bo@x.com'],
    ]);
  });

  it('un salto de línea dentro de comillas (Alt+Enter) es parte de la celda', () => {
    expect(parseDelimitedText('a,b\n"Ana\nPérez",a@x.com')).toEqual([
      ['a', 'b'],
      ['Ana\nPérez', 'a@x.com'],
    ]);
  });

  it('entiende \\n a secas igual que \\r\\n', () => {
    expect(parseDelimitedText('a;b\nc;d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('gridToRows', () => {
  it('exige las dos columnas, sin importar tildes ni mayúsculas', () => {
    const filas = gridToRows([
      ['  nombre COMPLETO ', 'CORREO ELECTRONICO'],
      ['Ana Pérez', 'ana@x.com'],
    ]);
    expect(filas).toEqual([{ line: 2, fullName: 'Ana Pérez', email: 'ana@x.com' }]);
  });

  it('el número de fila es el del ARCHIVO, contando la cabecera', () => {
    const filas = gridToRows([CABECERA, ['Ana', 'a@x.com'], ['Bea', 'b@x.com']]);
    expect(filas.map((f) => f.line)).toEqual([2, 3]);
  });

  it('salta las filas del todo vacías que deja Excel al arrastrar', () => {
    const filas = gridToRows([CABECERA, ['', ''], ['Ana', 'a@x.com'], ['   ', '']]);
    expect(filas).toEqual([{ line: 3, fullName: 'Ana', email: 'a@x.com' }]);
  });

  it('una fila con UN solo campo relleno NO está vacía: se conserva para que se informe de ella', () => {
    const filas = gridToRows([CABECERA, ['Ana', '']]);
    expect(filas).toEqual([{ line: 2, fullName: 'Ana', email: '' }]);
  });

  it('rechaza el archivo entero si sobra una columna', () => {
    expect(() => gridToRows([[...CABECERA, 'Es administrador'], ['Ana', 'a@x.com', 'sí']])).toThrow(
      /Nombre completo/,
    );
  });

  it('rechaza el archivo entero si las columnas están en otro orden — no se adivina por posición', () => {
    expect(() => gridToRows([[COLUMNA_CORREO, COLUMNA_NOMBRE], ['a@x.com', 'Ana']])).toThrow(
      /Nombre completo/,
    );
  });

  it('rechaza un archivo sin ninguna fila de datos', () => {
    expect(() => gridToRows([CABECERA])).toThrow(/ninguna fila/i);
  });

  it('el tope es 200 filas y 512 KB, por valor y no por la constante', () => {
    expect(MAX_BULK_ROWS).toBe(200);
    expect(MAX_BULK_FILE_BYTES).toBe(524288);
    expect(BULK_UPLOAD_LIMITS).toEqual({ fileSize: 524288, files: 1 });
    const grid = (n: number) => [CABECERA, ...Array.from({ length: n }, (_, i) => [`P${i}`, `p${i}@x.com`])];
    expect(gridToRows(grid(200))).toHaveLength(200);
    expect(() => gridToRows(grid(201))).toThrow(/200/);
  });

  it('una fila con hueco en la cuadrícula no revienta con un error de tipo', () => {
    const grid = [CABECERA, undefined, ['Ana', 'a@x.com']] as unknown as string[][];
    expect(gridToRows(grid)).toEqual([{ line: 3, fullName: 'Ana', email: 'a@x.com' }]);
  });

  it('una fila con una tercera celda rellena se señala, no se trunca, y las buenas siguen', () => {
    const filas = gridToRows([CABECERA, ['Pérez', 'Ana', 'ana@x.com'], ['Bea', 'b@x.com'], ['Cris', 'c@x.com', '']]);
    expect(filas).toHaveLength(3);
    expect(filas[0].line).toBe(2);
    expect(filas[0].problem).toMatch(/fila 2/);
    expect(filas[1]).toEqual({ line: 3, fullName: 'Bea', email: 'b@x.com' });
    expect(filas[2]).toEqual({ line: 4, fullName: 'Cris', email: 'c@x.com' });
  });

  it('rechaza el archivo ENTERO al pasarse del tope, no recorta las primeras', () => {
    const grid = [CABECERA, ...Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => [`P${i}`, `p${i}@x.com`])];
    expect(() => gridToRows(grid)).toThrow(new RegExp(String(MAX_BULK_ROWS)));
  });
});

describe('bordes del archivo que llega de fuera', () => {
  it('un archivo vacío no es una hoja con datos: se rechaza', () => {
    expect(() => parseDelimitedText(decodeTextFile(Buffer.alloc(0)))).toThrow(/vacío/i);
  });

  it('la marca de orden de bytes no estropea el primer encabezado', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Nombre completo;Correo electrónico\nAna;a@x.com', 'utf8'),
    ]);
    expect(gridToRows(parseDelimitedText(decodeTextFile(bytes)))).toEqual([
      { line: 2, fullName: 'Ana', email: 'a@x.com' },
    ]);
  });

  it('de punta a punta con lo que escribe un Excel en español: latin1, punto y coma, CRLF', () => {
    const bytes = Buffer.from('Nombre completo;Correo electrónico\r\nMu\xf1oz;m@x.com\r\n', 'latin1');
    expect(gridToRows(parseDelimitedText(decodeTextFile(bytes)))).toEqual([
      { line: 2, fullName: 'Muñoz', email: 'm@x.com' },
    ]);
  });

  it('una comilla sin cerrar rechaza el archivo en vez de tragarse las filas siguientes', () => {
    const filas = Array.from({ length: 22 }, (_, i) => `P${i},p${i}@x.com`);
    filas[1] = 'Ana "Anita,ana@x.com';
    const texto = ['Nombre completo,Correo electrónico', ...filas].join('\n');
    expect(() => parseDelimitedText(texto)).toThrow(/comillas.*sin cerrar/i);
  });

  it('exactamente MAX_BULK_ROWS filas se admite', () => {
    const grid = [CABECERA, ...Array.from({ length: MAX_BULK_ROWS }, (_, i) => [`P${i}`, `p${i}@x.com`])];
    expect(gridToRows(grid)).toHaveLength(MAX_BULK_ROWS);
  });

  it('las filas vacías no cuentan para el tope', () => {
    const grid = [CABECERA, ...Array.from({ length: 1000 }, () => ['', '']), ['Ana', 'a@x.com']];
    expect(gridToRows(grid)).toHaveLength(1);
  });
});

describe('la cabecera es el contrato', () => {
  it('una hoja propia con las cuatro columnas del cliente se rechaza entera, con el mensaje de la plantilla', () => {
    const grid = [
      ['Nombre completo', 'Puesto', 'Sexo', 'Correo'],
      ['Ana Pérez', 'Jefa', 'F', 'ana@x.com'],
    ];
    expect(() => gridToRows(grid)).toThrow(/plantilla/i);
    expect(() => gridToRows(grid)).toThrow(/Correo electrónico/);
  });

  it('las columnas vacías al final de la cabecera, artefacto de Excel, se recortan', () => {
    const filas = gridToRows([[...CABECERA, '', ' '], ['Ana', 'a@x.com', '', '']]);
    expect(filas).toEqual([{ line: 2, fullName: 'Ana', email: 'a@x.com' }]);
  });

  it('una columna vacía EN MEDIO de la cabecera sigue siendo un rechazo', () => {
    expect(() => gridToRows([[COLUMNA_NOMBRE, '', COLUMNA_CORREO], ['Ana', '', 'a@x.com']])).toThrow(/plantilla/i);
  });

  it('de punta a punta con un CSV de Excel con comas sobrantes', () => {
    const texto = 'Nombre completo,Correo electrónico,,\r\nAna,a@x.com,,\r\n';
    expect(gridToRows(parseDelimitedText(texto))).toEqual([{ line: 2, fullName: 'Ana', email: 'a@x.com' }]);
  });
});
