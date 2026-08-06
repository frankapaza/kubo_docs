import { BadRequestException } from '@nestjs/common';

/**
 * Reglas de admisión de adjuntos en tickets. Dominio puro: sin inyección de
 * dependencias, sin base de datos, sin `Date.now()`, sin tocar el disco. Todo
 * entra por parámetro -- mismo estilo que
 * `../../notifications/domain/template-renderer.ts`.
 *
 * Es la primera vez que gente ajena a la empresa sube ficheros a este
 * servidor. La lista de tipos aceptados (spec §3) es corta a propósito para
 * poder prescindir de un antivirus, pero esa renuncia **solo es válida si la
 * detección es real**: por los bytes del fichero, nunca por lo que el
 * navegador o el cliente digan que es. `nombre.png` declarado `image/png`
 * puede ser cualquier otra cosa por dentro -- ambos datos los pone quien
 * sube, y comprobar la extensión es no comprobar nada.
 *
 * Firmas usadas (primeros bytes del fichero, en hexadecimal):
 *
 * | Formato | Firma                                    | Notas |
 * |---|---|---|
 * | PNG  | `89 50 4E 47 0D 0A 1A 0A` (8 bytes)        | Firma única y completa. |
 * | JPEG | `FF D8 FF` (3 bytes)                       | SOI + inicio del primer marcador; todo JPEG (JFIF, EXIF, ...) empieza así. |
 * | GIF  | `47 49 46 38` + (`37 61` \| `39 61`)        | **Dos tramos contiguos**: el prefijo fijo "GIF8" y, justo detrás, la versión variable "7a" (GIF87a) o "9a" (GIF89a). |
 * | WebP | `52 49 46 46` ("RIFF") ... offset 8 `57 45 42 50` ("WEBP") | **Dos tramos NO contiguos**: "RIFF" y "WEBP" están separados por 4 bytes de tamaño de fichero (offset 4-7, variable, se ignoran). |
 * | PDF  | `25 50 44 46 2D` ("%PDF-") (5 bytes)       | Exigido por la especificación al inicio del fichero. |
 *
 * **El SVG queda fuera adrede.** No tiene firma binaria: es texto XML, y XML
 * admite `<script>` dentro. Es la trampa clásica de toda lista de
 * «imágenes», porque cualquiera lo cuenta como imagen -- aquí no cuenta.
 *
 * **Límite de la detección por firma**: solo mira la cabecera. Un fichero
 * que empieza con una firma válida (p. ej. PNG) y sigue con contenido de otra
 * naturaleza (un polígloto PNG/HTML) sigue detectándose como PNG -- ver el
 * test correspondiente en el spec. No es un descuido: parsear el fichero
 * entero para descartar polígotos exigiría decodificarlo (y decodificar
 * imágenes que manda gente de fuera es justo el tipo de superficie que el
 * diseño evita al no generar miniaturas en el servidor). La barrera para ese
 * caso es la segunda del diseño -- descarga forzada con
 * `Content-Disposition: attachment` y `X-Content-Type-Options: nosniff` --,
 * que vive en el controlador de descarga (tarea siguiente), no en este
 * módulo.
 */

/** Los cinco tipos, y nada más. Lista blanca, no negra. */
export type AllowedMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf';

export const ALLOWED_TYPES: readonly AllowedMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
];

/**
 * Tope por fichero: 10 MB. Pensado para el caso de uso real -- capturas de
 * pantalla (incluso en pantallas 4K, un PNG sin comprimir agresivamente rara
 * vez pasa de unos pocos MB) y PDF de factura (páginas de texto, unos pocos
 * cientos de KB salvo que lleven escaneos de baja calidad). 10 MB deja margen
 * holgado para ambos casos sin abrir la puerta a que un adjunto se convierta
 * en un vector de agotar disco por sí solo.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Tope acumulado por ticket: 50 MB. Un hilo de soporte con varias capturas de
 * ida y vuelta más algún PDF adjunto puede acumular varios ficheros; 50 MB
 * (cinco veces el máximo de uno solo) permite una conversación larga con
 * adjuntos de sobra sin que un solo ticket pueda crecer sin límite. Quien
 * necesite más espacio en un caso concreto es una excepción de soporte, no la
 * norma que debe permitir el sistema.
 *
 * Esta constante se expone para que la capa de servicio (con acceso a lo ya
 * guardado en el ticket) sume y decida -- este módulo no lleva estado ni
 * consulta nada, así que no puede saber cuánto lleva acumulado un ticket.
 */
export const MAX_TICKET_BYTES = 50 * 1024 * 1024;

/** Compara `bytes` contra la firma esperada a partir de `offset`, sin reventar con buffers cortos. */
function matchesSignature(buffer: Buffer, offset: number, signature: readonly number[]): boolean {
  if (buffer.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buffer[offset + i] !== signature[i]) return false;
  }
  return true;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_PREFIX = [0x47, 0x49, 0x46, 0x38]; // "GIF8"
const GIF_SUFFIX_87A = [0x37, 0x61]; // "7a"
const GIF_SUFFIX_89A = [0x39, 0x61]; // "9a"
const RIFF_MARK = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_MARK = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
const WEBP_MARK_OFFSET = 8; // tras "RIFF" (0-3) + tamaño (4-7)
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * Identifica el tipo real de `buffer` por su firma de bytes. Devuelve `null`
 * si no coincide con ninguno de los cinco tipos aceptados -- incluido un
 * buffer vacío o más corto que cualquier firma, sin reventar. Un SVG (u otro
 * XML) nunca coincide: no tiene firma binaria.
 */
export function detectMimeType(buffer: Buffer): AllowedMimeType | null {
  if (!buffer || buffer.length === 0) return null;

  if (matchesSignature(buffer, 0, PNG_SIGNATURE)) return 'image/png';
  if (matchesSignature(buffer, 0, JPEG_SIGNATURE)) return 'image/jpeg';

  if (
    matchesSignature(buffer, 0, GIF_PREFIX) &&
    (matchesSignature(buffer, 4, GIF_SUFFIX_87A) || matchesSignature(buffer, 4, GIF_SUFFIX_89A))
  ) {
    return 'image/gif';
  }

  if (matchesSignature(buffer, 0, RIFF_MARK) && matchesSignature(buffer, WEBP_MARK_OFFSET, WEBP_MARK)) {
    return 'image/webp';
  }

  if (matchesSignature(buffer, 0, PDF_SIGNATURE)) return 'application/pdf';

  return null;
}

/** Lo que llega de quien sube el fichero. Nada de esto es de fiar salvo `buffer`. */
export interface AttachmentCandidate {
  /** Contenido real del fichero. Es la única fuente de verdad de este módulo. */
  buffer: Buffer;
  /** Tipo MIME que declara el cliente (cabecera `Content-Type` del multipart). Solo para el mensaje de error. */
  declaredMime: string;
  /** Nombre original tal como lo mandó quien sube. Solo para mostrar y para el mensaje de error; nunca decide nada. */
  filename: string;
  /** Tamaño declarado del fichero, en bytes. */
  size: number;
}

/** Lo que un adjunto aceptado le deja a la capa de servicio. Sin clave de almacenamiento: eso lo genera otra capa. */
export interface AcceptedAttachment {
  mimeType: AllowedMimeType;
  /** Igual que `filename` de la entrada, sin sanear ni transformar. El saneado es cosa de quien lo pinta. */
  originalName: string;
  size: number;
}

function humanMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const rounded = Math.round(mb * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} MB`;
}

function reject(message: string): never {
  throw new BadRequestException({ code: 'BAD_INPUT', message });
}

/**
 * Decide si un adjunto entra o no. Es la puerta única: si esto deja pasar
 * algo que no debía, no hay ninguna otra capa deteniéndolo (no hay
 * antivirus, spec §3).
 *
 * Comprueba, por este orden:
 * 1. La firma real de `buffer` está entre los cinco tipos permitidos. Ni
 *    `declaredMime` ni `filename` participan en esta decisión -- solo se
 *    usan para redactar el mensaje si se rechaza.
 * 2. `size` no supera `MAX_FILE_BYTES`.
 *
 * No comprueba el presupuesto por ticket (`MAX_TICKET_BYTES`): eso exige
 * conocer lo ya guardado en el ticket, y este módulo no consulta nada.
 */
export function assertAcceptable(candidate: AttachmentCandidate): AcceptedAttachment {
  const { buffer, declaredMime, filename, size } = candidate;

  const mimeType = detectMimeType(buffer);
  if (!mimeType) {
    const declared = declaredMime && declaredMime.trim().length > 0 ? declaredMime : '(sin tipo declarado)';
    reject(
      `El archivo «${filename}» no es de un tipo permitido (declarado como ${declared}). ` +
        'Solo se aceptan imágenes PNG, JPEG, WebP o GIF, y documentos PDF.',
    );
  }

  if (size > MAX_FILE_BYTES) {
    reject(
      `El archivo «${filename}» pesa ${humanMegabytes(size)}, y el máximo permitido por archivo es ${humanMegabytes(MAX_FILE_BYTES)}.`,
    );
  }

  return { mimeType, originalName: filename, size };
}
