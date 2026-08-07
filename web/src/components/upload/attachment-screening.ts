import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  type AllowedMimeType,
} from '../../api/attachment-rules.generated';
import type { AttachmentErrorCode } from '../../api/ticket-messages.api';

/**
 * La criba que hace el navegador **antes** de subir nada.
 *
 * No es la validación: la validación vive en `assertAcceptable`, en el servidor,
 * y mira la firma de bytes del contenido -- lo único que no puede falsificar
 * quien sube. Aquí solo se dispone de `File.type` y `File.size`, que los pone el
 * navegador a partir de la extensión, así que esto es cortesía: ahorra el viaje
 * de subir 9 MB para que el servidor conteste que no. Los dos casos en los que
 * discrepan están asumidos y son inofensivos:
 *
 * - Un PNG con la extensión cambiada se rechaza aquí y el servidor lo habría
 *   aceptado. Es raro y el usuario tiene el arreglo delante (renombrarlo).
 * - Un `.png` que por dentro es otra cosa pasa aquí y el servidor lo rechaza,
 *   con su mensaje. Que la última palabra sea del servidor es justo el diseño.
 *
 * Lo que **no** es opcional es que la lista de tipos y el tope salgan de
 * `attachment-rules.generated.ts`, derivado del dominio del backend: si aquí
 * hubiera una lista escrita a mano, el día que el backend cambie la suya esta
 * pantalla aceptaría lo que el servidor rechaza (o al revés) y nadie se
 * enteraría hasta que un usuario lo sufriera.
 */

/** Un archivo que ha pasado la criba y espera a que se envíe el mensaje. */
export interface PendingAttachment {
  /**
   * Clave estable mientras el archivo esté en la lista: identifica su fila en
   * React y su URL de vista previa, que hay que revocar cuando desaparezca. No
   * vale el nombre -- dos capturas pegadas en el mismo segundo lo comparten.
   */
  id: string;
  file: File;
  /** El tipo aceptado, ya estrechado. El servidor volverá a decidirlo por los bytes. */
  mimeType: AllowedMimeType;
}

/** Un archivo rechazado, con el porqué. Nunca un «Error» a secas. */
export interface RejectedAttachment {
  id: string;
  filename: string;
  code: AttachmentErrorCode;
  /** Texto en español, con el nombre del archivo delante. */
  message: string;
}

/** Nombres para el ser humano, derivados de la lista generada (no de una copia). */
const TYPE_LABELS: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
};

/**
 * «PNG, JPEG, GIF, WebP o PDF», construido recorriendo `ALLOWED_MIME_TYPES`.
 *
 * Se genera en vez de escribirse porque el punto de todo esto es que no se
 * pueda quedar desfasado: un tipo nuevo en el backend aparece aquí solo, y si no
 * tiene etiqueta bonita sale su MIME, que es feo pero cierto -- mejor que
 * omitirlo y mentirle al usuario sobre lo que puede subir.
 */
function allowedTypesSentence(): string {
  const labels = ALLOWED_MIME_TYPES.map((type) => TYPE_LABELS[type] ?? type);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} o ${labels[labels.length - 1]}`;
}

export const ALLOWED_TYPES_SENTENCE = allowedTypesSentence();

/**
 * Tamaño en MB redondeado **hacia arriba** a un decimal, igual que
 * `humanMegabytesCeil` en el dominio del backend. Con redondeo normal, un
 * archivo de 10 486 000 B --un pelo por encima del tope-- se anunciaba como
 * «pesa 10 MB» contra «el máximo es 10 MB», que es un mensaje que se contradice
 * a sí mismo justo en el caso más frecuente.
 */
export function humanMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const roundedUp = Math.ceil(mb * 10) / 10;
  return `${Number.isInteger(roundedUp) ? roundedUp.toFixed(0) : roundedUp.toFixed(1)} MB`;
}

/** Tamaño para la lista de archivos elegidos: aquí sí se quiere el valor más cercano. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let sequence = 0;
/** Identificador único dentro de la sesión de la pestaña. No sale de aquí. */
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

export type ScreeningResult =
  | { accepted: PendingAttachment; rejected?: undefined }
  | { accepted?: undefined; rejected: RejectedAttachment };

/**
 * Pasa un archivo por la criba. Devuelve **o** el aceptado **o** el rechazado
 * con su motivo, nunca un booleano pelado: el motivo es el dato importante.
 *
 * El orden de las dos comprobaciones es el mismo que el del backend --primero el
 * tipo, luego el tamaño--, para que un archivo que incumple las dos cosas dé el
 * mismo motivo aquí que allí.
 */
export function screenFile(file: File): ScreeningResult {
  const filename = file.name?.trim() || '(sin nombre)';
  const declared = (file.type || '').toLowerCase();

  if (!isAllowedMimeType(declared)) {
    return {
      rejected: {
        id: nextId('rej'),
        filename,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message:
          `El archivo «${filename}» no es de un tipo permitido ` +
          `(el navegador lo declara como ${declared || 'desconocido'}). ` +
          `Solo se aceptan archivos ${ALLOWED_TYPES_SENTENCE}.`,
      },
    };
  }

  if (file.size > MAX_FILE_BYTES) {
    return {
      rejected: {
        id: nextId('rej'),
        filename,
        code: 'PAYLOAD_TOO_LARGE',
        message:
          `El archivo «${filename}» pesa ${humanMegabytes(file.size)}, ` +
          `y el máximo permitido por archivo es ${humanMegabytes(MAX_FILE_BYTES)}.`,
      },
    };
  }

  return { accepted: { id: nextId('adj'), file, mimeType: declared } };
}

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/** ¿Se puede pintar una vista previa de esto? El PDF entra en la lista blanca pero no es una imagen. */
export function isPreviewableImage(mimeType: string): boolean {
  return isAllowedMimeType(mimeType) && mimeType.startsWith('image/');
}

/** Extensión que le corresponde a un tipo aceptado, para nombrar lo que llega sin nombre. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Los nombres que ponen los navegadores a una captura del portapapeles. */
const GENERIC_PASTED_NAMES = /^(image|imagen)\.(png|jpe?g|gif|webp)$/i;

/**
 * Nombre legible para una captura pegada con Ctrl+V.
 *
 * Chrome le pone `image.png` a **todas**, y Firefox a veces no le pone nada. Con
 * cualquiera de las dos cosas, un hilo con cuatro capturas acaba con cuatro
 * archivos que se llaman igual y no hay forma de saber cuál es cuál ni desde la
 * lista ni desde la carpeta de descargas. Con la fecha y la hora sí, y de paso
 * quedan ordenados solos.
 *
 * Un archivo copiado del explorador de archivos **conserva su nombre**: ese sí
 * lo eligió alguien, y pisarlo sería peor.
 */
export function nameForPastedFile(file: File, now: Date): string {
  const original = file.name?.trim() ?? '';
  if (original && !GENERIC_PASTED_NAMES.test(original)) return original;

  const extension = EXTENSIONS[file.type?.toLowerCase() ?? ''] ?? 'png';
  return `Captura ${stamp(now)}.${extension}`;
}

/** `2026-08-07 15-42-03`: legible, ordenable y sin caracteres que un sistema de archivos rechace. */
function stamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${date} ${time}`;
}

/**
 * Los archivos de un evento de pegado, ya con nombre.
 *
 * Se rebautizan construyendo un `File` nuevo en vez de tocar el que llega: el
 * `name` de un `File` es de solo lectura, y `Object.defineProperty` sobre un
 * objeto del navegador es la clase de truco que deja de funcionar sin avisar.
 */
export function filesFromClipboard(clipboard: DataTransfer | null, now: Date): File[] {
  if (!clipboard) return [];

  return Array.from(clipboard.files).map((file) => {
    const name = nameForPastedFile(file, now);
    if (name === file.name) return file;
    return new File([file], name, { type: file.type, lastModified: file.lastModified });
  });
}
