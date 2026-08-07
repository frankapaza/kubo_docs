/**
 * GENERADO AUTOMÁTICAMENTE. No editar a mano.
 *
 * Fuente de verdad:
 *   backend/src/modules/ticket-messages/domain/attachment-rules.ts
 *
 * Para regenerarlo:  npm run sync:attachment-rules
 * Para comprobarlo:  npm run check:attachment-rules  (lo hace también `prebuild`)
 *
 * Estos valores no son una copia de conveniencia: son los mismos números y los
 * mismos tipos con los que `assertAcceptable` decide en el servidor. Si aquí
 * dijeran otra cosa, la interfaz aceptaría ficheros que el servidor rechaza y el
 * usuario se enteraría después de subirlos.
 */

/** Los tipos que el backend sabe reconocer por firma de bytes, y nada más. */
export type AllowedMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'application/pdf';

/** La lista, en el mismo orden en que el backend prueba las firmas. */
export const ALLOWED_MIME_TYPES: readonly AllowedMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
];

/** Tope por archivo, en bytes. El servidor mide el contenido real, nunca lo declarado. */
export const MAX_FILE_BYTES = 10485760;

/**
 * Tope acumulado por ticket, en bytes, **contando solo lo que sube el cliente**.
 * El equipo no tiene tope. El frontend no puede anticipar este corte (no conoce
 * lo ya guardado): lo aplica el servidor y llega como `CONFLICT`.
 */
export const MAX_TICKET_BYTES = 104857600;

/** Lo que el navegador puede poner en el `accept` de un `<input type="file">`. */
export const ACCEPT_ATTRIBUTE = ALLOWED_MIME_TYPES.join(',');
