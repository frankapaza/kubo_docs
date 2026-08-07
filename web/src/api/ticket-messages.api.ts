import type { AxiosInstance } from 'axios';
import axios from 'axios';

import { api } from './client';
import { portalApiClient } from './portal.api';
import { ALLOWED_MIME_TYPES, type AllowedMimeType } from './attachment-rules.generated';
import type {
  PortalPostedTicketMessage,
  PortalTicketAttachment,
  PortalTicketMessage,
  PostedTicketMessage,
  TicketAttachment,
  TicketMessage,
  TicketMessageVisibility,
} from './types';

/**
 * El hilo de mensajes y los adjuntos de un ticket, para las **dos** superficies.
 *
 * Se exportan dos objetos y no uno con un parámetro `esPortal`, porque las dos
 * puertas no comparten ni el cliente HTTP ni la forma de la respuesta:
 *
 * - `api` y `portalApiClient` son **dos instancias de axios deliberadamente
 *   separadas**, con su token en claves distintas de `localStorage`, para que un
 *   miembro del equipo y un cliente puedan tener sesión abierta a la vez en el
 *   mismo navegador. Elegir la instancia con un booleano en tiempo de ejecución
 *   es cómo una petición del panel acaba firmada con el token del cliente.
 * - El panel recibe la entidad (con `visibility` y los autores); el portal
 *   recibe una proyección donde ninguna de esas dos cosas existe. Ver los tipos
 *   en `types.ts`.
 *
 * Lo único que sí se comparte es el **transporte** de los adjuntos --subir y
 * traerse los bytes--, que es idéntico salvo el prefijo de la ruta y la
 * instancia: son las funciones privadas de abajo.
 */

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/**
 * Los códigos que el backend distingue al rechazar un adjunto. **No se
 * aplanan a un «Error» genérico**: quien arrastró cinco archivos y vio fallar
 * uno necesita saber si el problema fue el tipo o el tamaño, y son dos arreglos
 * distintos (convertirlo vs. comprimirlo).
 *
 * - `UNSUPPORTED_MEDIA_TYPE` (415) — `assertAcceptable`: la firma de bytes no es
 *   ninguna de las cinco permitidas.
 * - `PAYLOAD_TOO_LARGE` (413) — el archivo pasa de `MAX_FILE_BYTES`, lo corte
 *   multer o lo corte el dominio.
 * - `CONFLICT` (409) — el ticket está cerrado, o el cliente agotó el
 *   presupuesto acumulado del ticket. El frontend no puede anticiparlo.
 * - `UPLOAD_ERROR` / `BAD_INPUT` (400) — el multipart no se pudo leer.
 * - `NOT_FOUND` (404) — el mensaje, el ticket o el adjunto no existen *para
 *   quien pregunta*; el backend no distingue el caso a propósito.
 * - `NETWORK_ERROR` — no hubo respuesta. Es de este cliente, no del servidor.
 */
export type AttachmentErrorCode =
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'CONFLICT'
  | 'UPLOAD_ERROR'
  | 'BAD_INPUT'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR'
  | (string & {});

/** Un fallo de adjunto ya traducido: el código del backend y su texto en español. */
export interface AttachmentError {
  code: AttachmentErrorCode;
  /** El mensaje **del backend**, tal cual. Solo se inventa uno si no llegó ninguno. */
  message: string;
}

/** Cuerpo de error del proyecto (`HttpExceptionFilter`). */
interface ApiErrorBody {
  code?: unknown;
  message?: unknown;
}

/**
 * Error propio para lo que no viene de una respuesta HTTP con cuerpo JSON: hoy,
 * la descarga que llega con un `Content-Type` que no está en la lista blanca.
 * Se lanza en vez de devolver `null` para que no haya ningún camino en el que un
 * fallo se pierda por el desagüe sin que nadie se entere.
 */
export class AttachmentRequestError extends Error {
  readonly code: AttachmentErrorCode;

  constructor(code: AttachmentErrorCode, message: string) {
    super(message);
    this.name = 'AttachmentRequestError';
    this.code = code;
  }
}

const GENERIC_ERROR: AttachmentError = {
  code: 'UPLOAD_ERROR',
  message: 'No se pudo completar la operación con el archivo. Inténtalo de nuevo.',
};

const NETWORK_ERROR: AttachmentError = {
  code: 'NETWORK_ERROR',
  message: 'No se pudo contactar con el servidor. Comprueba tu conexión e inténtalo de nuevo.',
};

/**
 * Traduce lo que sea que se haya lanzado a `{ code, message }`.
 *
 * El texto es **el del backend**: sus mensajes ya están en español, ya dicen el
 * nombre del archivo cuando lo conocen y ya dicen el número exacto del tope
 * (`El archivo «captura.bmp» no es de un tipo permitido…`). Reescribirlos aquí
 * sería mantener dos redacciones del mismo rechazo, y la de aquí se quedaría
 * vieja el día que cambie el tope.
 *
 * El único caso que necesita cuidado es la **descarga**, que se pide con
 * `responseType: 'blob'`: entonces axios entrega también el cuerpo de error como
 * `Blob`, así que hay que leerlo antes de poder mirar dentro. Por eso esta
 * función es asíncrona.
 */
export async function describeAttachmentError(error: unknown): Promise<AttachmentError> {
  if (error instanceof AttachmentRequestError) {
    return { code: error.code, message: error.message };
  }

  if (!axios.isAxiosError(error)) return GENERIC_ERROR;
  if (!error.response) return NETWORK_ERROR;

  const body = await readErrorBody(error.response.data);
  const code = typeof body?.code === 'string' ? body.code : statusCode(error.response.status);
  const message = typeof body?.message === 'string' ? body.message : GENERIC_ERROR.message;

  return { code, message };
}

/** El cuerpo del error, venga como objeto ya parseado, como texto o como `Blob`. */
async function readErrorBody(data: unknown): Promise<ApiErrorBody | null> {
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()) as ApiErrorBody;
    } catch {
      // Un cuerpo que no es JSON no aporta nada; el `statusCode` de abajo ya
      // deja un código utilizable. No se traga el fallo: solo esta lectura.
      return null;
    }
  }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as ApiErrorBody;
    } catch {
      return null;
    }
  }
  if (data && typeof data === 'object') return data as ApiErrorBody;
  return null;
}

/** El mismo mapa de `HttpExceptionFilter.resolveCode`, para cuando el cuerpo no trajo `code`. */
function statusCode(status: number): AttachmentErrorCode {
  const map: Record<number, AttachmentErrorCode> = {
    400: 'BAD_INPUT',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    429: 'TOO_MANY_REQUESTS',
  };
  return map[status] ?? 'INTERNAL_ERROR';
}

// ---------------------------------------------------------------------------
// Transporte de adjuntos, común a las dos superficies
// ---------------------------------------------------------------------------

function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/** Sube el archivo en el campo `file`, que es el que espera `FileInterceptor`. */
function uploadTo<T>(client: AxiosInstance, path: string, file: File): Promise<T> {
  const form = new FormData();
  // El tercer argumento va explícito: sin él, algunos navegadores mandan
  // `blob` como nombre cuando el `File` se construyó a mano (las capturas
  // pegadas del portapapeles lo son).
  form.append('file', file, file.name);

  // Sin `Content-Type` a mano **a propósito**: lo pone el navegador con el
  // `boundary` del multipart, y escribirlo aquí lo dejaría sin él.
  return client.post<T>(path, form).then((r) => r.data);
}

/**
 * Trae los bytes del adjunto **con la sesión puesta**, y devuelve un `Blob` con
 * el tipo que dice el servidor.
 *
 * Por qué por JavaScript y no apuntando un `<img src>` al endpoint: una etiqueta
 * `<img>` no manda la cabecera `Authorization`, así que esa petición sale sin
 * sesión y el guard la corta. No hay forma de hacerlo con la etiqueta sola.
 *
 * **El tipo se toma del `Content-Type` de la respuesta, y se comprueba contra la
 * lista blanca antes de usarlo.** Es el tipo que el backend detectó por la firma
 * de bytes al subirlo, no el que declaró quien lo subió y no el que el navegador
 * adivinaría. Importa más de lo que parece: el `Blob` que se construye aquí
 * acaba en una URL `blob:`, y a una URL `blob:` **no llegan** ni el
 * `Content-Disposition: attachment` ni el `X-Content-Type-Options: nosniff` que
 * el servidor puso en la respuesta -- esas cabeceras se quedan en la respuesta
 * HTTP, no viajan con el objeto. Lo único que decide cómo se interpretará ese
 * objeto es el `type` con el que se construye, así que es el único sitio donde
 * se puede equivocar uno.
 *
 * Un tipo fuera de la lista se rechaza en vez de pintarse: si el servidor
 * empezara a devolver `text/html`, construir el `Blob` con ese tipo y enseñarlo
 * sería exactamente el agujero que la lista blanca del backend evita.
 */
async function fetchBlobFrom(client: AxiosInstance, path: string): Promise<Blob> {
  const response = await client.get<Blob>(path, { responseType: 'blob' });

  const declared = String(response.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (!isAllowedMimeType(declared)) {
    throw new AttachmentRequestError(
      'UNSUPPORTED_MEDIA_TYPE',
      `El servidor devolvió el adjunto con un tipo inesperado (${declared || 'sin tipo'}), así que no se muestra.`,
    );
  }

  // Se reconstruye en vez de devolver `response.data` tal cual: así el `type`
  // es el comprobado de arriba y no lo que axios haya inferido.
  return new Blob([response.data], { type: declared });
}

// ---------------------------------------------------------------------------
// Panel interno
// ---------------------------------------------------------------------------

export interface PostTicketMessageBody {
  bodyMd: string;
  /** Omitido significa `PUBLICA`: lo decide el backend, no este cliente. */
  visibility?: TicketMessageVisibility;
}

export const ticketMessagesApi = {
  listThread: (ticketId: number) =>
    api.get<TicketMessage[]>(`/tickets/${ticketId}/messages`).then((r) => r.data),

  post: (ticketId: number, body: PostTicketMessageBody) =>
    api.post<PostedTicketMessage>(`/tickets/${ticketId}/messages`, body).then((r) => r.data),

  listAttachments: (ticketId: number) =>
    api.get<TicketAttachment[]>(`/tickets/${ticketId}/attachments`).then((r) => r.data),

  uploadAttachment: (ticketId: number, messageId: number, file: File) =>
    uploadTo<TicketAttachment>(
      api,
      `/tickets/${ticketId}/messages/${messageId}/attachments`,
      file,
    ),

  fetchAttachmentBlob: (attachmentId: number) =>
    fetchBlobFrom(api, `/attachments/${attachmentId}/download`),
};

// ---------------------------------------------------------------------------
// Portal de clientes
// ---------------------------------------------------------------------------

export interface PostPortalMessageBody {
  bodyMd: string;
  // Sin `visibility`: un cliente no puede escribir notas internas y el DTO del
  // backend ni siquiera declara la clave.
}

export const portalTicketMessagesApi = {
  listThread: (ticketId: number) =>
    portalApiClient
      .get<PortalTicketMessage[]>(`/portal/tickets/${ticketId}/messages`)
      .then((r) => r.data),

  post: (ticketId: number, body: PostPortalMessageBody) =>
    portalApiClient
      .post<PortalPostedTicketMessage>(`/portal/tickets/${ticketId}/messages`, body)
      .then((r) => r.data),

  uploadAttachment: (ticketId: number, messageId: number, file: File) =>
    uploadTo<PortalTicketAttachment>(
      portalApiClient,
      `/portal/tickets/${ticketId}/messages/${messageId}/attachments`,
      file,
    ),

  fetchAttachmentBlob: (attachmentId: number) =>
    fetchBlobFrom(portalApiClient, `/portal/attachments/${attachmentId}/download`),
};

/**
 * Lo mínimo que necesita un componente para pintar o descargar un adjunto sin
 * saber de qué lado está. Las dos superficies lo cumplen; es lo que se le pasa a
 * `AttachmentImage`.
 */
export interface AttachmentBlobFetcher {
  fetchAttachmentBlob: (attachmentId: number) => Promise<Blob>;
}

// ---------------------------------------------------------------------------
// Descarga
// ---------------------------------------------------------------------------

/**
 * Guarda en disco un adjunto ya traído con `fetchAttachmentBlob`.
 *
 * Aquí está la regla que **no** se puede relajar: una URL `blob:` hereda el
 * origen de la aplicación y no lleva consigo ni `Content-Disposition` ni
 * `nosniff`, así que **nunca se navega a ella**. Ni `window.open`, ni un
 * `<a target="_blank">`, ni `location.href`. Un archivo que sea a la vez un PNG
 * válido y un HTML válido pasa la detección por firma del backend (que solo mira
 * la cabecera), y navegar a su `blob:` lo ejecutaría en este dominio con la
 * sesión del usuario delante.
 *
 * Lo que sí es seguro, y es lo que se hace: un ancla **con el atributo
 * `download`**, que en un objeto del mismo origen obliga al navegador a guardar
 * el archivo sin llegar a interpretarlo. El ancla no se llega a insertar en el
 * documento -- `click()` funciona igual sobre un elemento suelto --, así que en
 * el DOM no aparece nunca una URL `blob:` sobre la que alguien pueda pinchar.
 *
 * La URL se revoca en el mismo turno. La descarga ya está en marcha para
 * entonces: el navegador se queda con una referencia al objeto y no la pierde
 * por revocar el identificador.
 */
export function saveAttachmentToDisk(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    // Ni `target` ni `rel`: no hay navegación que endurecer, y un `target`
    // convertiría esto justamente en lo que no puede ser.
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
