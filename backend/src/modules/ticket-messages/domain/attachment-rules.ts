import { PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';

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
 * sube, y comprobar la extensión es no comprobar nada. Lo mismo vale para el
 * tamaño: `declaredSize` lo pone quien sube y nunca es la autoridad; la
 * autoridad es siempre `buffer.length` (ronda de corrección 1: un
 * `declaredSize` negativo, `NaN`, o menor que el contenido real, colaba un
 * adjunto que no debía entrar o mentía sobre cuánto ocupaba).
 *
 * Firmas usadas (primeros bytes del fichero, en hexadecimal):
 *
 * | Formato | Firma                                    | Notas |
 * |---|---|---|
 * | PNG  | `89 50 4E 47 0D 0A 1A 0A` (8 bytes)        | Firma única y completa. |
 * | JPEG | `FF D8 FF` (3 bytes)                       | SOI + inicio del primer marcador; todo JPEG (JFIF, EXIF, ...) empieza así. |
 * | GIF  | `47 49 46 38` + (`37 61` \| `39 61`)        | **Dos tramos contiguos**: el prefijo fijo "GIF8" y, justo detrás, la versión variable "7a" (GIF87a) o "9a" (GIF89a). |
 * | WebP | `52 49 46 46` ("RIFF") ... offset 8 `57 45 42 50` ("WEBP") | **Dos tramos NO contiguos**: "RIFF" y "WEBP" están separados por 4 bytes de tamaño de fichero (offset 4-7, variable, se ignoran). |
 * | PDF  | `25 50 44 46 2D` ("%PDF-") (5 bytes)       | Exigido por la especificación al inicio del fichero (no en cualquier posición). |
 *
 * **El SVG queda fuera adrede.** No tiene firma binaria: es texto XML, y XML
 * admite `<script>` dentro. Es la trampa clásica de toda lista de
 * «imágenes», porque cualquiera lo cuenta como imagen -- aquí no cuenta, y no
 * hace falta una regla específica contra él: ninguna de sus variantes (con
 * espacios, con declaración `<?xml ?>`, en mayúsculas, con BOM, ...) tiene
 * los bytes de ninguna firma binaria, así que ya queda fuera por ausencia en
 * la lista blanca. Es más fuerte que una exclusión explícita, que se podría
 * esquivar con la variante que a nadie se le ocurrió prohibir.
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

/** Los cinco tipos, y nada más. */
export type AllowedMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf';

/** Una regla de detección: su firma de bytes y el tipo que produce si casa. */
interface SignatureRule {
  mimeType: AllowedMimeType;
  matches(buffer: Buffer): boolean;
}

/** Compara `buffer` contra la firma esperada a partir de `offset`, sin reventar con buffers cortos. */
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
 * Única fuente de verdad de qué se acepta y cómo se reconoce. `ALLOWED_TYPES`
 * se deriva de esta lista (no al revés) precisamente para que no puedan
 * divergir: añadir un tipo aquí sin firma no compila una regla completa, y
 * añadirlo solo a `ALLOWED_TYPES` -- si alguna vez existiera por separado --
 * no lo haría detectable. La lista corta es la justificación de no tener
 * antivirus (spec §3); si esta lista fuera decorativa, esa renuncia dejaría
 * de sostenerse.
 */
const SIGNATURE_RULES: readonly SignatureRule[] = [
  { mimeType: 'image/png', matches: (b) => matchesSignature(b, 0, PNG_SIGNATURE) },
  { mimeType: 'image/jpeg', matches: (b) => matchesSignature(b, 0, JPEG_SIGNATURE) },
  {
    mimeType: 'image/gif',
    matches: (b) =>
      matchesSignature(b, 0, GIF_PREFIX) &&
      (matchesSignature(b, 4, GIF_SUFFIX_87A) || matchesSignature(b, 4, GIF_SUFFIX_89A)),
  },
  {
    mimeType: 'image/webp',
    matches: (b) => matchesSignature(b, 0, RIFF_MARK) && matchesSignature(b, WEBP_MARK_OFFSET, WEBP_MARK),
  },
  { mimeType: 'application/pdf', matches: (b) => matchesSignature(b, 0, PDF_SIGNATURE) },
];

/** Los cinco tipos, y nada más. Lista blanca, no negra. Derivada de `SIGNATURE_RULES`: ver su comentario. */
export const ALLOWED_TYPES: readonly AllowedMimeType[] = SIGNATURE_RULES.map((rule) => rule.mimeType);

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
 * Tope acumulado por ticket, **contando solo lo que sube el cliente**. El
 * equipo no tiene tope.
 *
 * No siempre fue así: la primera versión aplicaba el mismo tope a los dos
 * lados y era además histórico -- sobre un hilo sin edición ni borrado y sin
 * retención automática, eso deja el ticket permanentemente incapaz de
 * recibir un adjunto más, sin ninguna palanca para nadie, y el corte llega a
 * mitad de una conversación viva. El límite existe para que alguien de fuera
 * no llene el disco; el equipo no es esa amenaza, y dejar a un técnico sin
 * poder adjuntar el parche en su propio ticket es absurdo.
 *
 * 100 MB (el doble del valor anterior) da margen de sobra para un hilo largo
 * de capturas abierto por un cliente.
 *
 * **Este módulo no sabe quién sube cada adjunto**, así que no puede aplicar
 * el reparto por sí mismo: la capa de servicio (con acceso a lo ya guardado
 * y a quién lo subió) es quien debe sumar y cortar **solo** las subidas de
 * origen cliente contra esta constante, y debe hacerlo sin tocar las del
 * equipo. El mensaje que informe del corte a un cliente debe decir qué
 * hacer -- p. ej. mandarlo al técnico por otra vía para que él lo adjunte --
 * en vez de solo anunciar que está lleno; ese texto lo redacta la capa de
 * servicio, que es quien conoce al destinatario y el canal alternativo.
 */
export const MAX_TICKET_BYTES = 100 * 1024 * 1024;

/**
 * Identifica el tipo real de `buffer` por su firma de bytes, recorriendo
 * `SIGNATURE_RULES`. Devuelve `null` si no coincide con ninguno de los cinco
 * tipos aceptados -- incluido un buffer vacío o más corto que cualquier
 * firma, sin reventar. Un SVG (u otro XML, en cualquiera de sus variantes)
 * nunca coincide: no tiene firma binaria.
 */
export function detectMimeType(buffer: Buffer): AllowedMimeType | null {
  if (!buffer || buffer.length === 0) return null;

  for (const rule of SIGNATURE_RULES) {
    if (rule.matches(buffer)) return rule.mimeType;
  }

  return null;
}

/** Lo que llega de quien sube el fichero. Nada de esto es de fiar salvo `buffer`. */
export interface AttachmentCandidate {
  /** Contenido real del fichero. Es la única fuente de verdad de este módulo, para el tipo y para el tamaño. */
  buffer: Buffer;
  /** Tipo MIME que declara el cliente (cabecera `Content-Type` del multipart). Solo para el mensaje de error. */
  declaredMime: string;
  /** Nombre original tal como lo mandó quien sube. Solo para mostrar y para el mensaje de error; nunca decide nada. */
  filename: string;
  /**
   * Tamaño que declara quien sube (p. ej. el `Content-Length` del
   * multipart). Es un dato como `declaredMime`: no es de fiar, nunca decide
   * nada y nunca se devuelve. La autoridad sobre el tamaño real es siempre
   * `buffer.length` -- un `declaredSize` negativo, `NaN`, o inferior al
   * contenido real, no cambia el resultado.
   */
  declaredSize: number;
}

/** Lo que un adjunto aceptado le deja a la capa de servicio. Sin clave de almacenamiento: eso lo genera otra capa. */
export interface AcceptedAttachment {
  mimeType: AllowedMimeType;
  /** Igual que `filename` de la entrada, sin sanear ni transformar. El saneado es cosa de quien lo pinta. */
  originalName: string;
  /** El tamaño real, `buffer.length` -- nunca el declarado. Esto es lo que la capa de servicio debe sumar y guardar. */
  size: number;
}

/** Tope de caracteres de un dato ajeno (nombre o tipo declarado) dentro de un mensaje de error. */
const MESSAGE_FIELD_MAX_LENGTH = 80;

/** Recorta `value` para interpolarlo en un mensaje sin que un dato arbitrariamente largo infle la respuesta. */
function truncateForMessage(value: string, fallback: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return fallback;
  if (trimmed.length <= MESSAGE_FIELD_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, MESSAGE_FIELD_MAX_LENGTH)}…`;
}

/**
 * Tamaño en MB, redondeado **hacia arriba** a un decimal. Con `Math.round`
 * (la primera versión) un fichero de 10 486 000 bytes -- un pelo por encima
 * de los 10 MB de `MAX_FILE_BYTES` -- se mostraba como «pesa 10 MB» contra
 * «el máximo es 10 MB»: mensaje contradictorio, y encima el rango más
 * frecuente (el que se pasa por poco). Con `Math.ceil`, cualquier tamaño que
 * exceda un tope que sea un número entero de MB (los dos de este módulo lo
 * son) se muestra siempre con una cifra estrictamente mayor que la del tope.
 */
function humanMegabytesCeil(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const roundedUp = Math.ceil(mb * 10) / 10;
  return `${Number.isInteger(roundedUp) ? roundedUp.toFixed(0) : roundedUp.toFixed(1)} MB`;
}

/**
 * Decide si un adjunto entra o no. Es la puerta única: si esto deja pasar
 * algo que no debía, no hay ninguna otra capa deteniéndolo (no hay
 * antivirus, spec §3).
 *
 * Comprueba, por este orden:
 * 1. La firma real de `buffer` está entre los cinco tipos permitidos. Ni
 *    `declaredMime` ni `filename` participan en esta decisión -- solo se
 *    usan (recortados) para redactar el mensaje si se rechaza. Rechazo con
 *    `UNSUPPORTED_MEDIA_TYPE`: es un problema del tipo de fichero, distinto
 *    del de tamaño, y el componente de subida necesita distinguirlos.
 * 2. `buffer.length` -- nunca `declaredSize` -- no supera `MAX_FILE_BYTES`.
 *    Rechazo con `PAYLOAD_TOO_LARGE`, el mismo código que ya usa
 *    `MulterExceptionFilter` para el límite de tamaño en la subida de audio.
 *
 * No comprueba el presupuesto por ticket (`MAX_TICKET_BYTES`): eso exige
 * conocer lo ya guardado en el ticket y quién lo subió, y este módulo no
 * consulta nada ni sabe quién sube.
 */
export function assertAcceptable(candidate: AttachmentCandidate): AcceptedAttachment {
  const { buffer, declaredMime, filename } = candidate;
  const size = buffer.length;

  const mimeType = detectMimeType(buffer);
  if (!mimeType) {
    const safeName = truncateForMessage(filename, '(sin nombre)');
    const safeMime = truncateForMessage(declaredMime, '(sin tipo declarado)');
    throw new UnsupportedMediaTypeException({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message:
        `El archivo «${safeName}» no es de un tipo permitido (declarado como ${safeMime}). ` +
        'Solo se aceptan imágenes PNG, JPEG, WebP o GIF, y documentos PDF.',
    });
  }

  if (size > MAX_FILE_BYTES) {
    const safeName = truncateForMessage(filename, '(sin nombre)');
    throw new PayloadTooLargeException({
      code: 'PAYLOAD_TOO_LARGE',
      message: `El archivo «${safeName}» pesa ${humanMegabytesCeil(size)}, y el máximo permitido por archivo es ${humanMegabytesCeil(MAX_FILE_BYTES)}.`,
    });
  }

  return { mimeType, originalName: filename, size };
}
