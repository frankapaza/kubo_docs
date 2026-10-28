import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';

import { InternalServerErrorException, Logger } from '@nestjs/common';
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
 *
 * **Abrir un libro subido no pasa por aquí: pasa por otro hilo.** `exceljs`
 * carga el libro entero en memoria y no hay forma de pedirle un techo, así que
 * `readUploadedGrid` arranca `bulk-users-workbook.worker.ts` —que vuelve a
 * entrar por `parseWorkbookGrid`— con tope de memoria y con plazo. Escribir la
 * plantilla sí se hace aquí mismo: ese contenido lo ponemos nosotros.
 */

export const BULK_TEMPLATE_FILENAME = 'plantilla-usuarios-portal.xlsx';
export const BULK_TEMPLATE_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Tope de entradas del ZIP. Un libro de dos columnas y 200 filas tiene una
 * docena de entradas; 64 deja margen de sobra y corta en seco un `.zip` con
 * fotos dentro. Sale de la cabecera final del ZIP y se comprueba recorriendo
 * el directorio central, así que no se puede mentir sin romper el archivo.
 */
export const MAX_ZIP_ENTRIES = 64;

/**
 * **Lo que de verdad detiene una bomba de descompresión: el libro se abre en
 * otro hilo con tope de memoria, y lo que revienta es el hilo.**
 *
 * 64 MB, y el número está **medido**, no elegido por bonito (todas las cifras
 * de aquí, en este equipo, Node 24):
 *
 *  - Arrancar el hilo y cargar `exceljs` cuesta ~22 MB. Ese es el suelo.
 *  - La plantilla rellenada de verdad —200 filas, dos columnas, 10 KB— se abre
 *    sin pasar de ~22 MB: el suelo y nada más.
 *  - El libro VÁLIDO más denso que cabe en 512 KB (200 filas × 145 columnas de
 *    texto distinto, 502 KB) llega a ~45 MB y se abre bien. Ese es el techo de
 *    lo legítimo, y además es un archivo que la cabecera rechazaría acto
 *    seguido: el caso real está tres veces por debajo.
 *  - La bomba del informe —498 KB que inflan 500 MB— mata el hilo en ~0,8 s y
 *    el proceso solo sube 88 MB, contra los 634 MB que subía abriéndola aquí
 *    dentro.
 *
 * **Más grande NO es más seguro**, y esto también está medido: con 128 MB la
 * misma bomba tumba el PROCESO ENTERO en vez del hilo. Node le deja a V8 16 MB
 * de respiro para terminar el hilo ordenadamente cuando se pasa del tope; si
 * la reserva que estaba pidiendo no cabe en ese respiro, el fallo deja de ser
 * recuperable y es un `FATAL ERROR` de todo el proceso. Por eso el número va
 * clavado por una prueba que abre una bomba de verdad (`readUploadedGrid —
 * la bomba de descompresión`): quien lo suba tiene que volver a medir.
 */
export const WORKBOOK_THREAD_MEMORY_MB = 64;

/**
 * Plazo máximo del hilo. Abrir cualquier archivo de 512 KB tarda menos de un
 * segundo, así que esto no es un tope de rendimiento: es la red para un hilo
 * que se queda colgado sin llegar a pedir memoria —un ZIP cuyo flujo no acaba
 * nunca, un parser dando vueltas— y que si no, se quedaría ahí para siempre
 * con la petición esperando. Al agotarse NO se deja correr: se mata con
 * `terminate()`.
 *
 * 20 s y no 2 porque en desarrollo el hilo compila TypeScript al arrancar
 * (ver `entradaDelHilo`), y un plazo corto convertiría eso en fallos
 * intermitentes que nadie sabría leer.
 */
export const WORKBOOK_THREAD_TIMEOUT_MS = 20_000;

/** Lo que el hilo devuelve por `postMessage`. Ver `bulk-users-workbook.worker.ts`. */
export interface WorkbookThreadReply {
  ok: boolean;
  /** La cuadrícula, cuando `ok`. */
  grid?: string[][];
  /** El texto para el operador, cuando el libro se rechazó por su contenido. */
  rechazo?: string;
}

const logger = new Logger('BulkUsersWorkbook');

/**
 * Columnas que se leen de cada fila. Se leen TODAS las que haya (hasta este
 * tope) y no solo las dos primeras, para que el libro y el texto vean lo mismo:
 * un archivo de texto con una tercera columna con cabecera se rechaza, y un
 * libro igual no puede colarse por leer menos.
 */
const MAX_COLUMNAS_LEIDAS = 50;

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
 *
 * Los dos rechazos salen por el `throw` del final y **no por ninguna cláusula
 * propia**, porque no hacen falta: una fecha no tiene `richText`, ni `text`, ni
 * `result`, así que cae sola; y el error de una fórmula es un `{ error }` que
 * cae solo al recursar sobre él. Aquí hubo un `!(value instanceof Date)` y un
 * `!('error' in v)` que parecían protegerlas y no protegían nada —quitarlos no
 * cambió ni una prueba—. Lo que fija de verdad ese comportamiento son las dos
 * pruebas de la fecha y del `#DIV/0!`, no una condición que lo aparente.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (typeof value === 'object') {
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
    // `{ formula, result }`. Si el resultado es un error de fórmula —que llega
    // como `{ error: '#DIV/0!' }`—, la recursión cae al rechazo de abajo, que
    // es lo que se quiere.
    if ('result' in v) return cellText(v.result);
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
 * Dos reglas, las dos fallando cerrado (decisión 9 de la spec):
 *  1. Tiene que llevar `xl/workbook.xml`. Un `.docx`, un `.jar` y un `.zip` con
 *     fotos son todos ZIP válidos y ninguno es una hoja de cálculo.
 *  2. Como mucho `MAX_ZIP_ENTRIES` entradas.
 *
 * **Aquí había una tercera regla —la suma de tamaños SIN COMPRIMIR que declara
 * el directorio central, con un tope de 8 MB— y se ha quitado porque no
 * protegía de nada. Queda escrito para que nadie la vuelva a poner:**
 *
 *  - Ese campo lo escribe quien construye el archivo, y **mentir en él no
 *    cuesta nada**: poner 4 KB y meter 500 MB en el flujo es legal para
 *    cualquier escritor de ZIP.
 *  - Quien descomprime no lo usa como tope. `JSZip` —por debajo de `exceljs`—
 *    **infla la entrada entera en memoria y después compara** el tamaño
 *    obtenido con el declarado; si no casan lanza «uncompressed data size
 *    mismatch», con los 500 MB ya reservados. El campo sirve para comprobar
 *    integridad, jamás para decidir cuánto se va a inflar.
 *  - Medido: un archivo de 498 KB que DECLARA 4 KB pasa esta guarda y las
 *    otras tres, y subía 634 MB la memoria del proceso en una sola petición.
 *
 * Y aunque el campo no mintiera, tampoco bastaría: un libro **válido**, con sus
 * tamaños honrados y muchísimas cadenas compartidas, hace el mismo daño y
 * encima se parsea a objetos. Por eso lo que protege no es ninguna lectura de
 * cabeceras, sino abrir el libro en otro hilo con tope de memoria
 * (`WORKBOOK_THREAD_MEMORY_MB`). Lo que queda aquí son dos comprobaciones
 * estructurales baratas —no se puede mentir en ellas sin romper el ZIP— que
 * rechazan lo que no es un libro sin llegar a arrancar un hilo.
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
  let tieneLibro = false;

  for (let i = 0; i < entradas; i++) {
    if (offset + 46 > buffer.length) throw noEsUnLibro();
    if (buffer.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) throw noEsUnLibro();

    // El tamaño sin comprimir vive en `offset + 24` y NO se lee: ver arriba.
    const nombreLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const comentarioLen = buffer.readUInt16LE(offset + 32);

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

/**
 * Lo que ve el operador cuando el hilo muere por memoria. **Nunca el error
 * crudo**: `ERR_WORKER_OUT_OF_MEMORY` no le dice a nadie qué hacer, y el
 * detalle técnico va al log del servidor, no a la pantalla.
 */
function demasiadoGrandePorDentro(): ReturnType<typeof archivoRechazado> {
  return archivoRechazado(
    'El archivo es pequeño por fuera pero enorme por dentro: al abrirlo ocupa muchísima más ' +
      'memoria de la que puede ocupar una lista de usuarios, así que se ha cancelado sin leerlo ' +
      'y no se ha invitado a nadie. Descarga la plantilla, pega en ella solo las dos columnas ' +
      '(como mucho 200 filas) y vuelve a subirla. Si crees que el archivo es correcto, escríbenos.',
  );
}

/**
 * El hilo no llegó ni a contestar. **No es culpa del archivo**, así que no se
 * le dice al operador que descargue la plantilla: sería mandarle a corregir
 * algo que está bien. Es un 500, el motivo de verdad queda en el log del
 * servidor y la pantalla dice lo único accionable que hay.
 */
function seRompioElHilo(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'LECTURA_NO_DISPONIBLE',
    message:
      'No se ha podido abrir el archivo por un problema del servidor, y no se ha invitado a ' +
      'nadie. Vuelve a intentarlo; si sigue pasando, escríbenos.',
  });
}

/** Lo que ve el operador cuando el hilo se queda colgado y hay que matarlo. */
function tardaDemasiado(): ReturnType<typeof archivoRechazado> {
  return archivoRechazado(
    'El archivo ha tardado demasiado en abrirse y se ha cancelado; no se ha invitado a nadie. ' +
      'Descarga la plantilla, pega en ella solo las dos columnas (como mucho 200 filas) y vuelve ' +
      'a subirla. Si vuelve a pasar, escríbenos.',
  );
}

/**
 * Dónde está el hilo y con qué arranca.
 *
 * El mismo fichero existe en `.ts` (desarrollo y pruebas, bajo `ts-jest`) y en
 * `.js` (lo que se despliega, compilado en `dist/`), así que la extensión se
 * toma de ESTE módulo: si yo soy `.ts`, mi hermano también.
 *
 * En `.ts` hace falta registrar `ts-node` en el hilo, porque un `Worker` es un
 * Node de verdad y no sabe de TypeScript; se resuelve a ruta absoluta y
 * **solo en esa rama**, que es la única donde `ts-node` existe — la imagen de
 * producción instala con `--omit=dev` y allí `__filename` siempre acaba
 * en `.js`.
 */
function entradaDelHilo(): { fichero: string; execArgv: string[] } {
  const extension = path.extname(__filename);
  const fichero = path.join(__dirname, `bulk-users-workbook.worker${extension}`);
  if (extension !== '.ts') return { fichero, execArgv: [] };
  return { fichero, execArgv: ['--require', require.resolve('ts-node/register/transpile-only')] };
}

/**
 * Abre el libro **en otro hilo**, con tope de memoria y con plazo, y devuelve
 * la cuadrícula de texto.
 *
 * Esta es la guarda de verdad contra la bomba de descompresión, y el motivo de
 * que valga la pena el hilo está en una frase: **el backend es un solo
 * proceso**, el mismo que manda los avisos a los clientes y lee el correo
 * entrante. Un libro que agota la memoria aquí no tira esta pantalla: las tira
 * todas, para todos los clientes. Con el hilo, lo que se muere es el hilo.
 *
 * Qué se le da al hilo, y qué NO:
 *  - Los bytes del archivo, y nada más. Van por `workerData`, que los COPIA.
 *  - **Ni una sola variable de entorno del proceso.** Ahí viven el secreto de
 *    firma, la contraseña de la base y la del correo, y un hilo que solo abre
 *    un ZIP no tiene por qué poder leerlas. Si alguna vez una vulnerabilidad
 *    del parser consigue ejecutar algo, lo que se encuentra está vacío. La
 *    única excepción es dónde está el directorio temporal, que no es ni
 *    configuración ni credencial: sin ella `os.tmpdir()` devuelve dentro del
 *    hilo una ruta RELATIVA —`undefined\temp` en Windows— y cualquier paquete
 *    que la use se pone a escribir basura dentro del repositorio.
 *  - `argv: []` y, en producción, `execArgv: []` — tampoco hereda los
 *    argumentos con los que arrancó el proceso.
 *  - Su `stdout`/`stderr` no se mezclan con los del servidor; se vacían para
 *    que nada se quede acumulando en memoria.
 *
 * Los cuatro finales posibles, y ninguno sube un error crudo a la pantalla:
 *  - Contesta: cuadrícula, o el rechazo que escribió el propio lector —el
 *    archivo no es un libro, una celda no se puede leer— con su texto.
 *  - Se pasa de memoria: `ERR_WORKER_OUT_OF_MEMORY` → texto de bomba.
 *  - Se cuelga: al agotarse el plazo se le mata con `terminate()` y sale el
 *    texto de «ha tardado demasiado». Matarlo no es opcional: sin eso el hilo
 *    seguiría comiendo CPU y memoria después de haber contestado al operador.
 *  - Revienta por cualquier otra cosa, o muere sin contestar: eso **no es
 *    culpa del archivo** —lo que trae el archivo ya lo ha recogido el `catch`
 *    de dentro del hilo— sino nuestro, típicamente un despliegue sin el
 *    fichero del hilo. Sale como fallo del servidor y no como «descarga la
 *    plantilla», que mandaría al operador a dar vueltas sobre un archivo que
 *    está bien.
 *
 * `plazoMs` existe para poder PROBAR el plazo sin esperar veinte segundos;
 * nadie en producción lo pasa. Es la única forma de ejercitar la red del
 * hilo colgado, que por definición no se puede provocar con un archivo.
 */
export function parseWorkbookInThread(
  buffer: Buffer,
  plazoMs: number = WORKBOOK_THREAD_TIMEOUT_MS,
): Promise<string[][]> {
  const { fichero, execArgv } = entradaDelHilo();

  return new Promise<string[][]>((resolve, reject) => {
    const hilo = new Worker(fichero, {
      workerData: new Uint8Array(buffer),
      env: { TMPDIR: os.tmpdir(), TEMP: os.tmpdir(), TMP: os.tmpdir() },
      argv: [],
      execArgv,
      resourceLimits: { maxOldGenerationSizeMb: WORKBOOK_THREAD_MEMORY_MB },
      stdout: true,
      stderr: true,
    });
    hilo.stdout.resume();
    hilo.stderr.resume();

    let resuelto = false;
    const plazo = setTimeout(() => {
      acabar(() => reject(tardaDemasiado()), 'el hilo agotó el plazo y se ha matado');
    }, plazoMs);

    /**
     * Cierra una sola vez: mata el hilo, quita el plazo y contesta. Pase lo que
     * pase después —un `exit` tardío, un `error` de la propia muerte— ya no se
     * vuelve a contestar.
     */
    function acabar(responder: () => void, diagnostico?: string): void {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(plazo);
      if (diagnostico) logger.warn(`Lectura del libro abortada: ${diagnostico}`);
      void hilo.terminate();
      responder();
    }

    hilo.on('message', (respuesta: WorkbookThreadReply) => {
      acabar(() => {
        if (respuesta?.ok && respuesta.grid) resolve(respuesta.grid);
        else if (respuesta?.rechazo) reject(archivoRechazado(respuesta.rechazo));
        else reject(noEsUnLibro());
      });
    });

    hilo.on('error', (err: Error & { code?: string }) => {
      const porMemoria = err.code === 'ERR_WORKER_OUT_OF_MEMORY';
      acabar(
        () => reject(porMemoria ? demasiadoGrandePorDentro() : seRompioElHilo()),
        // El detalle técnico al log y NUNCA a la respuesta: puede llevar rutas
        // internas del paquete.
        `${err.code ?? 'error'} — ${err.message}`,
      );
    });

    // Un hilo que muere sin contestar ni emitir error (lo mató el sistema, se
    // llamó a `process.exit`) no puede dejar la petición colgada para siempre.
    hilo.on('exit', (codigo) => {
      acabar(() => reject(seRompioElHilo()), `el hilo terminó con código ${codigo} sin contestar`);
    });
  });
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
 * y, para un libro, las dos comprobaciones estructurales del ZIP. Lo que pase
 * de ahí se abre en otro hilo con tope de memoria y con plazo
 * (`parseWorkbookInThread`), porque ninguna lectura de cabeceras puede saber
 * cuánto va a ocupar un libro al abrirlo. El tope de filas lo aplica después
 * `gridToRows`.
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

  return parseWorkbookInThread(buffer);
}

/**
 * El libro, abierto de verdad y convertido en cuadrícula de texto.
 *
 * **Esto corre DENTRO del hilo** (`bulk-users-workbook.worker.ts`), que es el
 * único sitio donde está acotado lo que puede llegar a ocupar. Quien lea un
 * archivo subido llama a `readUploadedGrid`, nunca a esto.
 */
export async function parseWorkbookGrid(buffer: Buffer): Promise<string[][]> {
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

  // **Solo se lee la PRIMERA hoja**, y cuando esa está en blanco hay que
  // decirlo con esas palabras. Si no, el archivo de quien tiene sus datos en
  // la segunda pestaña salía por el «la primera fila no coincide con la
  // plantilla» de `gridToRows`: verdad, e inservible. El operador se pone a
  // revisar sus columnas, que están bien, y no se le ocurre que lo que falla
  // sea en qué pestaña están.
  if (grid.every((fila) => fila.every((celda) => celda === ''))) {
    throw datosEnOtraHoja(wb.worksheets.length > 1);
  }

  return grid;
}

/**
 * La primera hoja no tiene nada. El texto cambia según haya más pestañas o no,
 * porque el arreglo es distinto: mover los datos, o escribirlos.
 */
function datosEnOtraHoja(hayMasHojas: boolean): ReturnType<typeof archivoRechazado> {
  return archivoRechazado(
    hayMasHojas
      ? 'La primera hoja del libro está vacía y solo se lee esa. Tus datos están en otra ' +
          'pestaña: muévelos a la primera —o descarga la plantilla y pégalos en su hoja ' +
          '«Usuarios»— y vuelve a subirlo.'
      : 'La hoja del libro está vacía: no tiene ni la cabecera ni ninguna fila. Descarga la ' +
          'plantilla, escribe los datos debajo de la cabecera y vuelve a subirla.',
  );
}
