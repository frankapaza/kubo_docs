import * as ExcelJS from 'exceljs';

import {
  CABECERA_PLANTILLA,
  MAX_BULK_FILE_BYTES,
  MAX_BULK_ROWS,
  archivoRechazado,
  decodeTextFile,
  looksLikeZip,
  parseDelimitedText,
} from './domain/bulk-user-file';

/**
 * La hoja de cálculo de la carga masiva: la que se reparte y la que vuelve.
 *
 * **Este es el único fichero del proyecto que importa `exceljs`.** No es una
 * convención de estilo: es lo que hace que cambiar de librería el día que
 * haga falta sea reescribir un fichero en vez de buscarla por el proyecto
 * (riesgo 4 de la spec). Quien necesite leer un archivo subido llama a
 * `readUploadedGrid` y recibe texto. Una prueba vigila la frontera.
 */

export const BULK_TEMPLATE_FILENAME = 'plantilla-usuarios-portal.xlsx';
export const BULK_TEMPLATE_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Guardas contra la bomba de descompresión (decisión 9 de la spec).
 *
 * Un `.xlsx` es un ZIP, y un ZIP de 300 KB puede declararse como gigabytes al
 * descomprimir. `exceljs` carga el libro entero en memoria, así que la guarda
 * tiene que aplicarse **antes** de dárselo.
 *
 * Un libro de dos columnas y 200 filas tiene una docena de entradas y unos
 * pocos cientos de KB sin comprimir. 64 y 8 MB dejan margen de sobra y siguen
 * muy por debajo de lo que hace daño.
 */
export const MAX_ZIP_ENTRIES = 64;
export const MAX_ZIP_DECLARED_BYTES = 8 * 1024 * 1024;

/**
 * Columnas que se leen de cada fila. Se leen TODAS las que haya (hasta este
 * tope) y no solo las dos primeras, para que el libro y el texto vean lo mismo:
 * un archivo de texto con una tercera columna con cabecera se rechaza, y un
 * libro igual no puede colarse por leer menos.
 */
const MAX_COLUMNAS_LEIDAS = 50;

/** Marca de que un tamaño de 32 bits no cabe y vive en el registro ZIP64. */
const ZIP64_MARK = 0xffffffff;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
/** El comentario final de un ZIP cabe en 65 535 bytes; la EOCD ocupa 22. */
const MAX_EOCD_SEARCH = 65535 + 22;

/**
 * La plantilla que se descarga.
 *
 * Es `.xlsx` y no CSV a propósito (decisión 2 de la spec): Excel la abre sin
 * asistente de importación, y aquí se puede dejar las columnas **formateadas
 * como texto** —lo que impide que Excel autocorrija o reformatee una
 * dirección— y la cabecera inmovilizada.
 *
 * **La cabecera sale de `CABECERA_PLANTILLA`**, la misma constante que
 * `gridToRows` exige al leer: no hay dos textos que mantener.
 *
 * **Sin filas de ejemplo ni notas en la hoja de datos.** Una fila de ejemplo
 * olvidada invitaría a una persona que no existe, y una nota se leería como una
 * fila con un correo vacío. Las instrucciones van en una segunda hoja, que el
 * lector nunca mira.
 *
 * **Sin ninguna fecha**, ni en el contenido ni en el nombre del archivo. Es la
 * forma más barata de no tener el octavo fallo de zona horaria de esta serie.
 */
export async function buildBulkTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('Usuarios');

  hoja.columns = CABECERA_PLANTILLA.map((header, i) => ({
    header,
    key: `c${i}`,
    width: i === 0 ? 34 : 38,
    style: { numFmt: '@' },
  }));
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  const ayuda = wb.addWorksheet('Instrucciones');
  ayuda.getColumn(1).width = 100;
  [
    'Cómo rellenar la plantilla',
    '1. Escribe una persona por fila en la hoja «Usuarios», debajo de la cabecera.',
    '2. No cambies ni muevas la primera fila: el archivo se rechaza si no coincide.',
    `3. Máximo ${MAX_BULK_ROWS} filas por archivo. Si tienes más, súbelos en varios archivos.`,
    '4. La contraseña la elige cada persona desde el enlace que recibe por correo.',
    '5. Esta carga no crea administradores.',
  ].forEach((linea, i) => {
    const fila = ayuda.addRow([linea]);
    if (i === 0) fila.font = { bold: true };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Una celda de Excel convertida a texto.
 *
 * **Una celda no es siempre una cadena**, y ahí hay una trampa concreta: al
 * teclear un correo, Excel lo convierte en hipervínculo y `exceljs` devuelve
 * `{ text, hyperlink }`. Un `String(valor)` a secas metería `[object Object]`
 * en el correo de alguien. Es el fallo que solo se caza en producción, porque
 * en desarrollo los archivos de prueba se escriben con un script y no
 * tecleando en Excel.
 *
 * Lo que no sabe convertir lo **rechaza** en vez de adivinarlo: una fecha en la
 * columna del nombre no tiene ninguna lectura correcta, y un `#DIV/0!` tampoco.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (typeof value === 'object' && !(value instanceof Date)) {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return v.richText
        .map((f) => String((f as { text?: unknown }).text ?? ''))
        .join('')
        .trim();
    }
    // El hipervínculo que Excel pone solo. Recursivo, porque su `text` puede
    // ser a su vez texto enriquecido.
    if ('text' in v) return cellText(v.text);
    // `{ formula, result }`. Si el resultado es un error de fórmula, la
    // recursión cae al rechazo de abajo, que es lo que se quiere.
    if ('result' in v && !('error' in v)) return cellText(v.result);
  }

  throw archivoRechazado(
    'Hay una celda que no se puede leer como texto (una fecha, un error de fórmula o algo ' +
      'incrustado). Deja en las dos columnas solo texto y vuelve a subirlo.',
  );
}

/**
 * Comprueba que ese ZIP es un libro de Excel **usable**, sin descomprimir ni un
 * byte: se recorre el directorio central, que son cabeceras.
 *
 * Tres reglas, todas fallando cerrado (decisión 9 de la spec):
 *  1. Tiene que llevar `xl/workbook.xml`. Un `.docx`, un `.jar` y un `.zip` con
 *     fotos son todos ZIP válidos y ninguno es una hoja de cálculo.
 *  2. Como mucho `MAX_ZIP_ENTRIES` entradas.
 *  3. La suma de tamaños declarados sin comprimir, por debajo de
 *     `MAX_ZIP_DECLARED_BYTES`. Un tamaño con la marca de ZIP64 se rechaza: un
 *     libro de 200 filas no la necesita, y aceptarla sería aceptar un tamaño
 *     que la cabecera ya no dice.
 *
 * **Límite conocido:** esos tamaños los escribe quien construyó el archivo y
 * pueden mentir. Esta guarda para la bomba ingenua. Lo que acota el caso
 * adverso es que la ruta está detrás de sesión, personal de la casa, rol ADMIN
 * y asiento en `audit_log`: no es una superficie anónima.
 */
export function assertUsableWorkbookZip(buffer: Buffer): void {
  const eocd = buscarEocd(buffer);
  if (eocd < 0) throw noEsUnLibro();

  const entradas = buffer.readUInt16LE(eocd + 10);
  if (entradas > MAX_ZIP_ENTRIES) {
    throw archivoRechazado(
      'El archivo tiene demasiadas partes dentro para ser una plantilla rellenada. ' +
        'Descarga la plantilla y vuelve a rellenarla.',
    );
  }

  let offset = buffer.readUInt32LE(eocd + 16);
  let declarados = 0;
  let tieneLibro = false;

  for (let i = 0; i < entradas; i++) {
    if (offset + 46 > buffer.length) throw noEsUnLibro();
    if (buffer.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) throw noEsUnLibro();

    const sinComprimir = buffer.readUInt32LE(offset + 24);
    const nombreLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const comentarioLen = buffer.readUInt16LE(offset + 32);

    if (sinComprimir === ZIP64_MARK) throw demasiadoGrande();
    declarados += sinComprimir;
    if (declarados > MAX_ZIP_DECLARED_BYTES) throw demasiadoGrande();

    if (offset + 46 + nombreLen > buffer.length) throw noEsUnLibro();
    const nombre = buffer.toString('latin1', offset + 46, offset + 46 + nombreLen);
    if (nombre === 'xl/workbook.xml') tieneLibro = true;

    offset += 46 + nombreLen + extraLen + comentarioLen;
  }

  if (!tieneLibro) throw noEsUnLibro();
}

function noEsUnLibro(): ReturnType<typeof archivoRechazado> {
  return archivoRechazado(
    'El archivo no es una hoja de cálculo de Excel. Descarga la plantilla, rellénala y súbela.',
  );
}

function demasiadoGrande(): ReturnType<typeof archivoRechazado> {
  return archivoRechazado(
    'El archivo declara un contenido demasiado grande para una plantilla de usuarios. ' +
      'Descarga la plantilla y vuelve a rellenarla.',
  );
}

/** La cabecera final del ZIP, buscada desde el final. El archivo cabe en 512 KB: es barato. */
function buscarEocd(buffer: Buffer): number {
  const desde = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let i = buffer.length - 22; i >= desde; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * **La única puerta de lectura de un archivo subido.**
 *
 * Decide por los BYTES, jamás por la extensión ni por el `Content-Type`: los
 * dos los pone quien sube. Si empieza por la firma de un ZIP va a la rama del
 * libro; si no, a la de texto separado, que exige que decodifique a texto sin
 * ningún byte nulo.
 *
 * Los topes se aplican **antes** de cargar nada: primero el tamaño del archivo
 * y, para un libro, las cabeceras del ZIP. El tope de filas lo aplica después
 * `gridToRows`; a `exceljs` solo llega lo que ya cabe en 512 KB y declara
 * menos de 8 MB al descomprimir.
 */
export async function readUploadedGrid(buffer: Buffer): Promise<string[][]> {
  if (buffer.length > MAX_BULK_FILE_BYTES) {
    throw archivoRechazado(
      `El archivo es demasiado pesado: el máximo son ${MAX_BULK_FILE_BYTES / 1024} KB. ` +
        'Una plantilla con hasta 200 usuarios pesa mucho menos; revisa que no lleve imágenes ni filas de más.',
    );
  }

  if (!looksLikeZip(buffer)) {
    return parseDelimitedText(decodeTextFile(buffer));
  }

  assertUsableWorkbookZip(buffer);

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as never);
  } catch {
    // El detalle del fallo de `exceljs` es diagnóstico interno y puede llevar
    // rutas internas del paquete: no sale hacia arriba.
    throw noEsUnLibro();
  }

  const hoja = wb.worksheets[0];
  if (!hoja) throw noEsUnLibro();

  const columnas = Math.min(Math.max(hoja.columnCount, CABECERA_PLANTILLA.length), MAX_COLUMNAS_LEIDAS);
  const grid: string[][] = [];
  // Fila a fila desde la 1, también las vacías: sin eso, una fila en blanco en
  // medio desplazaría la numeración de todas las de abajo, y el número de fila
  // es lo único que hace accionable el informe. `gridToRows` ya salta las vacías.
  for (let r = 1; r <= hoja.rowCount; r++) {
    const fila = hoja.getRow(r);
    const celdas: string[] = [];
    for (let c = 1; c <= columnas; c++) celdas.push(cellText(fila.getCell(c).value));
    grid.push(celdas);
  }
  // Excel deja filas formateadas y vacías al final: no son datos.
  while (grid.length > 1 && grid[grid.length - 1].every((c) => c === '')) grid.pop();

  return grid;
}
