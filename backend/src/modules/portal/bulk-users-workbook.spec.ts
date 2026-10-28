import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';

import {
  CABECERA_PLANTILLA,
  COLUMNA_CORREO,
  COLUMNA_NOMBRE,
  MAX_BULK_FILE_BYTES,
  gridToRows,
} from './domain/bulk-user-file';
import {
  MAX_ZIP_ENTRIES,
  assertUsableWorkbookZip,
  buildBulkTemplate,
  cellText,
  readUploadedGrid,
} from './bulk-users-workbook';

/** Un libro de verdad con las filas que se le pasen: no se prueba contra un ZIP inventado. */
async function libroCon(filas: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('Usuarios');
  filas.forEach((fila) => hoja.addRow(fila));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Reescribe el tamaño sin comprimir de la primera entrada del directorio
 * central. Vive en la prueba y no en el código: es una forja, no una utilidad.
 */
function inflarPrimerTamanoDeclarado(zip: Buffer, tamano: number): Buffer {
  const copia = Buffer.from(zip);
  const inicio = copia.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  if (inicio < 0) throw new Error('el ZIP de prueba no tiene directorio central');
  copia.writeUInt32LE(tamano, inicio + 24);
  return copia;
}

/** Una EOCD mínima, para forjar ZIP que no son libros. */
function zipForjado(entradas: number): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas, 10);
  eocd.writeUInt32LE(4, 16);
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), eocd]);
}

describe('buildBulkTemplate', () => {
  it('produce un .xlsx de verdad, con las dos columnas del contrato en la primera fila', async () => {
    const grid = await readUploadedGrid(await buildBulkTemplate());
    expect(grid[0]).toEqual([COLUMNA_NOMBRE, COLUMNA_CORREO]);
  });

  it('la cabecera de la plantilla ES la que exige el lector, no un texto parecido', async () => {
    // Se rellena la plantilla descargada como lo haría el operador y se pasa
    // por el lector real: si alguien cambia un lado y no el otro, esto cae.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildBulkTemplate()) as never);
    wb.worksheets[0].addRow(['Ocaña Núñez', 'ocana@x.com']);
    const relleno = Buffer.from(await wb.xlsx.writeBuffer());

    expect(gridToRows(await readUploadedGrid(relleno))).toEqual([
      { line: 2, fullName: 'Ocaña Núñez', email: 'ocana@x.com' },
    ]);
    expect(CABECERA_PLANTILLA).toEqual([COLUMNA_NOMBRE, COLUMNA_CORREO]);
  });

  it('no trae filas de datos: una fila de ejemplo olvidada invitaría a una persona inexistente', async () => {
    const grid = await readUploadedGrid(await buildBulkTemplate());
    expect(grid).toHaveLength(1);
  });

  it('las instrucciones van en otra hoja, para que no se cuelen como fila de datos', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildBulkTemplate()) as never);
    expect(wb.worksheets).toHaveLength(2);
    expect(wb.worksheets[0].name).toBe('Usuarios');
  });

  it('no lleva ninguna fecha: la forma más barata de no tener un octavo fallo de zona horaria', async () => {
    const grid = await readUploadedGrid(await buildBulkTemplate());
    const todo = grid.flat().join(' ');
    expect(todo).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(todo).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  });
});

describe('cellText — lo que Excel mete de verdad en una celda', () => {
  it('el correo convertido en hipervínculo, que es lo que hace Excel al teclearlo', () => {
    expect(cellText({ text: 'ana@x.com', hyperlink: 'mailto:ana@x.com' })).toBe('ana@x.com');
  });

  it('texto enriquecido', () => {
    expect(cellText({ richText: [{ text: 'Ana ' }, { text: 'Pérez' }] })).toBe('Ana Pérez');
  });

  it('el resultado de una fórmula, no la fórmula', () => {
    expect(cellText({ formula: 'CONCAT(A1,B1)', result: 'ana@x.com' })).toBe('ana@x.com');
  });

  it('un número se pasa a texto en vez de reventar', () => {
    expect(cellText(1234)).toBe('1234');
  });

  it('vacío y nulo son la cadena vacía', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });

  it('una fecha se RECHAZA: no hay lectura correcta de una fecha en estas dos columnas', () => {
    expect(() => cellText(new Date(0))).toThrow(/no se puede leer/i);
  });

  it('un error de fórmula se RECHAZA en vez de colar «#DIV/0!» como nombre', () => {
    expect(() => cellText({ formula: 'A1/0', result: { error: '#DIV/0!' } })).toThrow(
      /no se puede leer/i,
    );
  });

  it('un error de celda suelto también se rechaza', () => {
    expect(() => cellText({ error: '#N/A' })).toThrow(/no se puede leer/i);
  });
});

describe('assertUsableWorkbookZip', () => {
  it('deja pasar la plantilla que genera este mismo módulo', async () => {
    const plantilla = Buffer.from(await buildBulkTemplate());
    expect(() => assertUsableWorkbookZip(plantilla)).not.toThrow();
  });

  it('un buffer vacío no es un ZIP', () => {
    expect(() => assertUsableWorkbookZip(Buffer.alloc(0))).toThrow(/hoja de cálculo/i);
  });

  it('rechaza un ZIP sin xl/workbook.xml — un .docx también es un ZIP válido', () => {
    expect(() => assertUsableWorkbookZip(zipForjado(0))).toThrow(/hoja de cálculo/i);
  });

  it('rechaza un ZIP con demasiadas entradas', () => {
    expect(() => assertUsableWorkbookZip(zipForjado(MAX_ZIP_ENTRIES + 1))).toThrow(
      /demasiadas partes/i,
    );
  });

  it('rechaza un ZIP que declara más bytes sin comprimir de los que se admiten', async () => {
    const bueno = Buffer.from(await buildBulkTemplate());
    // Se reescribe el tamaño DECLARADO, no se descomprime nada: la guarda lee
    // cabeceras, y esta prueba comprueba justo eso.
    expect(() => assertUsableWorkbookZip(inflarPrimerTamanoDeclarado(bueno, 0xfffffffe))).toThrow(
      /demasiado grande/i,
    );
  });

  it('rechaza la marca de ZIP64: un libro de 200 filas no la necesita', async () => {
    const bueno = Buffer.from(await buildBulkTemplate());
    expect(() => assertUsableWorkbookZip(inflarPrimerTamanoDeclarado(bueno, 0xffffffff))).toThrow(
      /demasiado grande/i,
    );
  });
});

describe('readUploadedGrid — decide por los bytes, nunca por la extensión', () => {
  it('lee un libro con el correo hecho hipervínculo por Excel', async () => {
    const libro = await libroCon([
      [COLUMNA_NOMBRE, COLUMNA_CORREO],
      ['Ana Pérez', { text: 'ana@x.com', hyperlink: 'mailto:ana@x.com' }],
    ]);
    expect(await readUploadedGrid(libro)).toEqual([
      [COLUMNA_NOMBRE, COLUMNA_CORREO],
      ['Ana Pérez', 'ana@x.com'],
    ]);
  });

  it('Ocaña y Núñez sobreviven al libro: ida y vuelta', async () => {
    const libro = await libroCon([
      [COLUMNA_NOMBRE, COLUMNA_CORREO],
      ['Ocaña Núñez', 'ocana@x.com'],
    ]);
    expect((await readUploadedGrid(libro))[1][0]).toBe('Ocaña Núñez');
  });

  it('Ocaña y Núñez sobreviven al texto, en UTF-8 con marca y en latin1', async () => {
    const texto = `${COLUMNA_NOMBRE},${COLUMNA_CORREO}\r\nOcaña Núñez,o@x.com\r\n`;
    const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(texto, 'utf8')]);
    const latin1 = Buffer.from(texto, 'latin1');
    for (const archivo of [utf8, latin1]) {
      expect(await readUploadedGrid(archivo)).toEqual([
        [COLUMNA_NOMBRE, COLUMNA_CORREO],
        ['Ocaña Núñez', 'o@x.com'],
      ]);
    }
  });

  it('una fila vacía en medio no desplaza el número de las de abajo', async () => {
    const libro = await libroCon([[COLUMNA_NOMBRE, COLUMNA_CORREO], [], ['Luis', 'l@x.com']]);
    expect(gridToRows(await readUploadedGrid(libro))).toEqual([
      { line: 3, fullName: 'Luis', email: 'l@x.com' },
    ]);
  });

  it('ve las mismas columnas que el texto: una tercera con cabecera se rechaza, no se ignora', async () => {
    const libro = await libroCon([
      [COLUMNA_NOMBRE, COLUMNA_CORREO, 'Puesto'],
      ['A', 'a@x.com', 'x'],
    ]);
    const grid = await readUploadedGrid(libro);
    expect(() => gridToRows(grid)).toThrow(/plantilla/i);
  });

  it('la hoja real de cuatro columnas (nombre, puesto, sexo, correo) se rechaza entera', async () => {
    const libro = await libroCon([
      ['Nombre', 'Puesto', 'Sexo', 'Correo'],
      ['Ana', 'Jefa', 'F', 'a@x.com'],
    ]);
    const grid = await readUploadedGrid(libro);
    expect(() => gridToRows(grid)).toThrow(/plantilla/i);
  });

  it('lee texto separado por punto y coma en latin1, sin marca de codificación', async () => {
    const csv = Buffer.from(
      `${COLUMNA_NOMBRE};${COLUMNA_CORREO}\r\nMu\xf1oz Pe\xf1a;m@x.com\r\n`,
      'latin1',
    );
    expect(await readUploadedGrid(csv)).toEqual([
      [COLUMNA_NOMBRE, COLUMNA_CORREO],
      ['Muñoz Peña', 'm@x.com'],
    ]);
  });

  it('un PNG renombrado a .xlsx no pasa: no es ZIP y no decodifica a texto', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    await expect(readUploadedGrid(png)).rejects.toThrow(/hoja de cálculo/i);
  });

  it('rechaza por tamaño antes de mirar el contenido', async () => {
    const grande = Buffer.alloc(MAX_BULK_FILE_BYTES + 1, 0x61);
    await expect(readUploadedGrid(grande)).rejects.toThrow(/demasiado pesado/i);
  });

  it('un libro que incumple la guarda de ZIP no llega a exceljs', async () => {
    const bueno = Buffer.from(await buildBulkTemplate());
    await expect(readUploadedGrid(inflarPrimerTamanoDeclarado(bueno, 0xfffffffe))).rejects.toThrow(
      /demasiado grande/i,
    );
  });

  it('un ZIP que no es libro se rechaza con un mensaje que manda a la plantilla', async () => {
    await expect(readUploadedGrid(zipForjado(0))).rejects.toThrow(/plantilla/i);
  });
});

describe('frontera de la dependencia', () => {
  it('solo bulk-users-workbook.ts importa exceljs (las pruebas aparte)', () => {
    const raiz = path.resolve(__dirname, '../..');
    const ofensores: string[] = [];
    const recorrer = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(ruta);
        else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) {
          const src = fs.readFileSync(ruta, 'utf8');
          if (/(from|require\()\s*['"]exceljs['"]/.test(src) && e.name !== 'bulk-users-workbook.ts')
            ofensores.push(ruta);
        }
      }
    };
    recorrer(raiz);
    expect(ofensores).toEqual([]);
  });
});
