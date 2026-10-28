import {
  COLUMNA_CORREO,
  COLUMNA_NOMBRE,
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

  it('cae a latin1 cuando los bytes NO son UTF-8 válido — el Excel en español', () => {
    // `Muñoz` con la eñe en un solo byte (0xF1): lo que escribe Excel al
    // guardar «CSV (delimitado por comas)» en un Windows en español.
    expect(decodeTextFile(Buffer.from('Mu\xf1oz', 'latin1'))).toBe('Muñoz');
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

  it('rechaza el archivo ENTERO al pasarse del tope, no recorta las primeras', () => {
    const grid = [CABECERA, ...Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => [`P${i}`, `p${i}@x.com`])];
    expect(() => gridToRows(grid)).toThrow(new RegExp(String(MAX_BULK_ROWS)));
  });
});

describe('bordes del archivo que llega de fuera', () => {
  it('un archivo vacío no es una hoja con datos: se rechaza', () => {
    expect(() => parseDelimitedText(decodeTextFile(Buffer.alloc(0)))).toThrow(/separador/i);
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

  it('una comilla sin cerrar no revienta: sale una cuadrícula finita', () => {
    expect(() => parseDelimitedText('a,b\n"x,y\nz')).not.toThrow();
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
