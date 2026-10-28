import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
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
  parseWorkbookInThread,
  readUploadedGrid,
} from './bulk-users-workbook';

/** Un libro de verdad con las filas que se le pasen: no se prueba contra un ZIP inventado. */
async function libroCon(filas: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('Usuarios');
  filas.forEach((fila) => hoja.addRow(fila));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CRC-32 de toda la vida. Lo exige el formato ZIP; sin él no hay forja creíble. */
function crc32(datos: Buffer): number {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  let c = -1;
  for (let i = 0; i < datos.length; i++) c = tabla[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Un ZIP escrito a mano, entrada a entrada, con la opción de **mentir en el
 * tamaño sin comprimir** que se declara (que es justo lo que hace una bomba de
 * descompresión de verdad).
 *
 * Vive en la prueba y no en el código: es una forja, no una utilidad. Y se
 * escribe a mano, sin ningún paquete de ZIP, porque el punto de la prueba es
 * precisamente controlar un campo que ningún escritor decente deja tocar.
 */
function zipForjadoCon(
  entradas: { nombre: string; datos: Buffer; declara?: number }[],
): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;

  for (const { nombre, datos, declara } of entradas) {
    const comprimido = zlib.deflateRawSync(datos, { level: 9 });
    const nom = Buffer.from(nombre, 'latin1');
    const declarado = declara ?? datos.length;
    const suma = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(declarado, 22);
    local.writeUInt16LE(nom.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(suma, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(declarado, 24);
    central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(offset, 42);

    locales.push(local, nom, comprimido);
    centrales.push(central, nom);
    offset += 30 + nom.length + comprimido.length;
  }

  const cuerpo = Buffer.concat(locales);
  const directorio = Buffer.concat(centrales);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(directorio.length, 12);
  eocd.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, directorio, eocd]);
}

/** Lo mínimo de `xl/workbook.xml` para que el archivo pase por libro. */
const WORKBOOK_XML = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheets><sheet name="Usuarios" sheetId="1"/></sheets></workbook>',
);

/**
 * **La bomba.** Pequeña por fuera, enorme por dentro: unos 255 KB de archivo
 * que inflan `infladoMB` megas, y que además **declaran 4 KB** en su propio
 * directorio central — el campo del que se fiaba la guarda vieja.
 */
function bombaDeDescompresion(infladoMB: number): Buffer {
  return zipForjadoCon([
    { nombre: 'xl/workbook.xml', datos: WORKBOOK_XML },
    {
      nombre: 'xl/sharedStrings.xml',
      datos: Buffer.alloc(infladoMB * 1024 * 1024, 'a'),
      declara: 4096,
    },
  ]);
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

  it('una bomba que miente en el tamaño declarado PASA esta guarda: por eso no es la que protege', () => {
    // Deja constancia de lo que esta guarda NO puede hacer. El tamaño sin
    // comprimir lo escribe quien forja el archivo; aquí declara 4 KB e infla
    // 256 MB, y las comprobaciones estructurales —es un ZIP, lleva
    // `xl/workbook.xml`, tiene dos entradas— son todas ciertas. Quien lo para
    // es el hilo con tope de memoria, no esto.
    expect(() => assertUsableWorkbookZip(bombaDeDescompresion(16))).not.toThrow();
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

  it('un ZIP que no es libro se rechaza con un mensaje que manda a la plantilla', async () => {
    await expect(readUploadedGrid(zipForjado(0))).rejects.toThrow(/plantilla/i);
  });
});

describe('readUploadedGrid — la bomba de descompresión', () => {
  /**
   * El caso del informe, forjado aquí: **255 KB de archivo que inflan 256 MB**,
   * y que además declaran 4 KB en su directorio central.
   *
   * Pasa las cuatro guardas de entrada —cabe en 512 KB, empieza por la firma
   * de un ZIP, lleva `xl/workbook.xml` y tiene dos entradas— y aun así tiene
   * que salir con un texto en español, sin que el proceso se entere. Abierta
   * en este mismo proceso, la misma bomba subía la memoria 634 MB.
   *
   * 256 MB y no 500 para que la prueba no cueste medio giga de RAM al
   * construirla: con un tope de hilo de 64 MB, cuatro veces el tope ya es
   * tanto como cuarenta.
   */
  it('un archivo pequeño que infla 256 MB se rechaza limpio, y el proceso sigue vivo', async () => {
    const bomba = bombaDeDescompresion(256);
    expect(bomba.length).toBeLessThan(MAX_BULK_FILE_BYTES);

    await expect(readUploadedGrid(bomba)).rejects.toThrow(/enorme por dentro/i);

    // La mitad que de verdad importa: el proceso que acaba de recibir la bomba
    // sigue sirviendo. Si el tope matara al servidor en vez de al hilo, esto
    // no llegaría a ejecutarse.
    const grid = await readUploadedGrid(await buildBulkTemplate());
    expect(grid[0]).toEqual([COLUMNA_NOMBRE, COLUMNA_CORREO]);
  }, 60_000);

  it('un hilo que no contesta a tiempo se mata, y lo que sale es un texto, no un error crudo', async () => {
    // Plazo de 1 ms: el hilo no llega ni a arrancar. No se prueba lo rápido
    // que es nadie, se prueba la red del hilo colgado —que por definición no
    // se puede provocar con un archivo— y que al agotarse el plazo se
    // responde y se mata, en vez de esperar para siempre.
    await expect(parseWorkbookInThread(await buildBulkTemplate(), 1)).rejects.toThrow(
      /tardado demasiado/i,
    );

    // Y detrás de eso el lector sigue funcionando: matar un hilo no deja el
    // proceso tocado.
    expect(await readUploadedGrid(await buildBulkTemplate())).toHaveLength(1);
  }, 60_000);

  it('el límite del hilo deja margen de sobra para un libro legítimo lleno', async () => {
    // 200 filas, el tope del contrato. Medido: se abre con ~22 MB, un tercio
    // del tope del hilo.
    const filas: string[][] = [[COLUMNA_NOMBRE, COLUMNA_CORREO]];
    for (let i = 0; i < 200; i++) filas.push([`Persona Número ${i}`, `p${i}@empresa-cliente.com`]);
    const grid = await readUploadedGrid(await libroCon(filas));
    expect(grid).toHaveLength(201);
  }, 60_000);
});

describe('readUploadedGrid — solo se lee la primera hoja, y se dice', () => {
  it('con los datos en la segunda hoja, el mensaje manda a MOVERLOS, no a revisar columnas', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Hoja1');
    const segunda = wb.addWorksheet('Datos');
    segunda.addRow([COLUMNA_NOMBRE, COLUMNA_CORREO]);
    segunda.addRow(['Ana Pérez', 'ana@x.com']);

    await expect(readUploadedGrid(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow(
      /primera hoja.*vacía|otra pestaña/is,
    );
  });

  it('con una sola hoja y vacía, el mensaje no habla de pestañas: no hay ninguna a la que ir', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Usuarios');
    await expect(readUploadedGrid(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow(
      /hoja del libro está vacía/i,
    );
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
