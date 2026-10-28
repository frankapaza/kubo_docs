import { BadRequestException } from '@nestjs/common';

/**
 * El contrato del archivo de carga masiva de usuarios de cliente.
 *
 * Dominio puro: no consulta la base, no manda correo, no lee el reloj y
 * **no importa `exceljs`**. Lo que sabe de hojas de cálculo vive en
 * `../bulk-users-workbook.ts`; aquí solo entran cuadrículas de texto ya
 * leídas y buffers de texto plano.
 *
 * Lanza excepciones de Nest, como `ticket-messages/domain/attachment-rules.ts`:
 * es el precedente de la casa para un dominio que decide admisión, y evita que
 * cada llamante invente su propio código de error para la misma regla.
 */

/**
 * Tope de filas de datos. Pasarse rechaza el ARCHIVO ENTERO; no se recortan
 * las primeras 200.
 *
 * Truncar en silencio es el peor de los tres resultados posibles: el operador
 * vería «invitadas 200» y no tendría forma de saber que faltan. El caso real
 * son 22 personas.
 */
export const MAX_BULK_ROWS = 200;

/**
 * Tope de tamaño: 512 KB. La plantilla con 22 filas pesa unos 6 KB, así que
 * esto son dos órdenes de magnitud de margen y sigue siendo irrelevante para
 * la memoria del proceso.
 */
export const MAX_BULK_FILE_BYTES = 512 * 1024;

/**
 * El mismo tope con la forma que espera multer, y **un solo archivo por
 * petición**. Es la criba que corta ANTES de tener el archivo entero en
 * memoria; no es quien decide si el contenido vale. Mismo criterio, y por el
 * mismo motivo, que `ATTACHMENT_UPLOAD_LIMITS`.
 */
export const BULK_UPLOAD_LIMITS = { fileSize: MAX_BULK_FILE_BYTES, files: 1 } as const;

/** Los dos encabezados, tal cual se escriben en la plantilla. */
export const COLUMNA_NOMBRE = 'Nombre completo';
export const COLUMNA_CORREO = 'Correo electrónico';

/**
 * La cabecera del contrato, en una sola cosa: la plantilla la ESCRIBE y
 * `gridToRows` la EXIGE leyendo esta misma constante, así que no pueden
 * divergir sin que fallen las pruebas.
 */
export const CABECERA_PLANTILLA: readonly string[] = [COLUMNA_NOMBRE, COLUMNA_CORREO];

/** Una fila del archivo, todavía sin validar nada de su contenido. */
export interface RawBulkRow {
  /** Número de fila **en el archivo**, contando la cabecera. Es lo único que hace accionable el informe. */
  line: number;
  fullName: string;
  email: string;
}

/** Cuerpo único de los rechazos que tumban el archivo entero. */
export function archivoRechazado(message: string): BadRequestException {
  return new BadRequestException({ code: 'ARCHIVO_NO_VALIDO', message });
}

/**
 * El encabezado, comparable.
 *
 * Recorta, baja a minúsculas, quita las tildes y colapsa los espacios. Las
 * cuatro cosas porque las cuatro pasan de verdad: quien rellena la plantilla
 * escribe «CORREO ELECTRONICO», o mete un espacio de más, o su Excel
 * autocorrige la tilde. Rechazar por eso sería rechazar por nada.
 *
 * `normalize('NFD')` + quitar los diacríticos, no una tabla de sustituciones:
 * una tabla se olvida de la diéresis el día que alguien escriba «Bilingüe».
 */
export function normalizeHeader(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Firma de un ZIP local file header: `PK\x03\x04`. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/**
 * Si esos bytes empiezan por la firma de un ZIP —y por tanto pueden ser un
 * `.xlsx`, que es un ZIP—.
 *
 * **Por los bytes, jamás por la extensión ni por el `Content-Type`.** Los dos
 * los pone quien sube, y comprobar la extensión es no comprobar nada. Misma
 * disciplina que `attachment-rules.ts`.
 */
export function looksLikeZip(buffer: Buffer): boolean {
  if (buffer.length < ZIP_SIGNATURE.length) return false;
  return ZIP_SIGNATURE.every((byte, i) => buffer[i] === byte);
}

/** Marca de orden de bytes de UTF-8. */
const BOM = [0xef, 0xbb, 0xbf];

/**
 * Los bytes, convertidos a texto.
 *
 * Dos cuidados, y los dos vienen de lo que Excel hace de verdad al guardar un
 * CSV (decisión 2 de la spec):
 *
 * 1. **La marca de orden de bytes se quita.** Excel la escribe al guardar
 *    «CSV UTF-8» y no al guardar «CSV» a secas. Si se deja, el primer
 *    encabezado pasa a ser `﻿Nombre completo` y no casa con nada — un
 *    archivo perfectamente correcto rechazado por un carácter invisible.
 * 2. **La codificación se deduce, no se supone.** Si los bytes son UTF-8
 *    válido, es UTF-8; si no, se lee como `latin1`, que es lo que escribe un
 *    Excel en español cuando no pone la marca. La comprobación es
 *    reinterpretar y comparar los bytes, la misma que hace
 *    `decodeMultipartFilename` en `common/http/`, y no una lista de
 *    codificaciones a probar: el caso real es exactamente ese, nombres con
 *    tildes y eñes.
 *
 * Y una tercera cosa, que es una defensa y no una comodidad: **un byte nulo
 * significa que esto no es texto**. Es lo que descarta un binario cualquiera
 * renombrado a `.csv`, que es lo único que llega a esta rama después de que
 * `looksLikeZip` se haya llevado los ZIP.
 */
export function decodeTextFile(buffer: Buffer): string {
  const sinBom =
    buffer.length >= 3 && BOM.every((byte, i) => buffer[i] === byte) ? buffer.subarray(3) : buffer;

  if (sinBom.includes(0x00)) {
    throw archivoRechazado(
      'El archivo no es una hoja de cálculo ni un archivo de texto. ' +
        'Descarga la plantilla, rellénala y súbela sin cambiarle el formato.',
    );
  }

  const comoUtf8 = sinBom.toString('utf8');
  const esUtf8Valido = Buffer.from(comoUtf8, 'utf8').equals(sinBom);
  return esUtf8Valido ? comoUtf8 : sinBom.toString('latin1');
}

/** Los tres separadores que se aceptan, en orden de preferencia ante un empate. */
const SEPARADORES = [',', ';', '\t'] as const;

/**
 * El separador del archivo, olfateado en la línea de encabezado.
 *
 * Se cuenta **fuera de comillas**: un encabezado entrecomillado con comas
 * dentro (`"Pérez, Ana"`) no debe ganarle al separador de verdad. Sin esto, un
 * archivo con `;` y una celda con comas se partía por donde no era.
 */
export function sniffDelimiter(headerLine: string): string {
  const conteo = new Map<string, number>(SEPARADORES.map((s) => [s, 0]));
  let dentroDeComillas = false;

  for (const caracter of headerLine) {
    if (caracter === '"') {
      dentroDeComillas = !dentroDeComillas;
      continue;
    }
    if (dentroDeComillas) continue;
    const previo = conteo.get(caracter);
    if (previo !== undefined) conteo.set(caracter, previo + 1);
  }

  let mejor = '';
  let mejorConteo = 0;
  for (const separador of SEPARADORES) {
    const veces = conteo.get(separador)!;
    if (veces > mejorConteo) {
      mejor = separador;
      mejorConteo = veces;
    }
  }

  if (!mejor) {
    throw archivoRechazado(
      'No se reconoce el separador del archivo. La primera fila tiene que llevar las columnas ' +
        `«${COLUMNA_NOMBRE}» y «${COLUMNA_CORREO}» separadas por coma, punto y coma o tabulador.`,
    );
  }
  return mejor;
}

/**
 * El texto separado, convertido en cuadrícula.
 *
 * Escrito a mano y no con un paquete: el acuerdo es **una sola dependencia
 * nueva** (`exceljs`, para la otra mitad del formato), y lo que hace falta aquí
 * —olfatear el separador y deducir la codificación— no lo hace ningún
 * analizador genérico a nuestro gusto. El subconjunto que se cubre es el que
 * escribe Excel: comillas, comillas dobles escapadas, y los dos finales de
 * línea.
 */
export function parseDelimitedText(text: string): string[][] {
  const primeraLinea = text.split(/\r?\n/, 1)[0] ?? '';
  const separador = sniffDelimiter(primeraLinea);

  const filas: string[][] = [];
  let celdas: string[] = [];
  let celda = '';
  let dentroDeComillas = false;

  for (let i = 0; i < text.length; i++) {
    const caracter = text[i];

    if (dentroDeComillas) {
      if (caracter === '"') {
        // Dos comillas seguidas dentro de un campo entrecomillado son UNA
        // comilla literal, no el cierre. Es como Excel escribe un apellido
        // con comillas dentro.
        if (text[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          dentroDeComillas = false;
        }
      } else {
        celda += caracter;
      }
      continue;
    }

    if (caracter === '"') {
      dentroDeComillas = true;
    } else if (caracter === separador) {
      celdas.push(celda);
      celda = '';
    } else if (caracter === '\n') {
      celdas.push(celda);
      filas.push(celdas);
      celdas = [];
      celda = '';
    } else if (caracter !== '\r') {
      celda += caracter;
    }
  }

  // La última fila no lleva salto detrás si el archivo no termina en uno.
  if (celda !== '' || celdas.length > 0) {
    celdas.push(celda);
    filas.push(celdas);
  }

  return filas;
}

/**
 * La cuadrícula, comprobada contra el contrato de columnas y convertida en
 * filas con su número de línea.
 *
 * **No se adivina por posición.** Un archivo con las dos columnas cambiadas de
 * sitio se rechaza en vez de invitar a todo el mundo con el nombre en el
 * correo. La cabecera es un contrato, y esta función es donde se exige.
 */
export function gridToRows(grid: string[][]): RawBulkRow[] {
  // Excel deja columnas vacías al final de la cabecera al guardar un CSV
  // ("Nombre completo,Correo,,"): es un artefacto suyo, no un error de nadie.
  const cabecera = (grid[0] ?? []).map(normalizeHeader);
  while (cabecera.length > 0 && cabecera[cabecera.length - 1] === '') cabecera.pop();
  const esperada = CABECERA_PLANTILLA.map(normalizeHeader);

  const cabeceraCorrecta =
    cabecera.length === esperada.length && esperada.every((nombre, i) => cabecera[i] === nombre);

  if (!cabeceraCorrecta) {
    throw archivoRechazado(
      `La primera fila no coincide con la plantilla: tiene que llevar exactamente dos columnas, ` +
        `«${COLUMNA_NOMBRE}» y «${COLUMNA_CORREO}», en ese orden. Descarga la plantilla y pega ahí ` +
        'tus datos; no se puede subir una hoja propia con otras columnas.',
    );
  }

  const filas: RawBulkRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const fullName = (grid[i][0] ?? '').trim();
    const email = (grid[i][1] ?? '').trim();

    // Del todo vacía: la deja Excel al arrastrar y no es un error de nadie.
    // Una fila con UN campo relleno SÍ es un error, y se conserva para poder
    // informar de ella — callarla sería decidir por la ausencia de un valor.
    if (fullName === '' && email === '') continue;

    if (filas.length >= MAX_BULK_ROWS) {
      throw archivoRechazado(
        `El archivo tiene más de ${MAX_BULK_ROWS} filas. Divídelo en varios archivos y súbelos ` +
          'de uno en uno.',
      );
    }
    filas.push({ line: i + 1, fullName, email });
  }

  if (filas.length === 0) {
    throw archivoRechazado('El archivo no tiene ninguna fila con datos debajo de la cabecera.');
  }

  return filas;
}
