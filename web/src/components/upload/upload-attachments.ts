import { MAX_FILE_BYTES } from '../../api/attachment-rules.generated';
import {
  describeAttachmentError,
  type AttachmentError,
  type AttachmentErrorCode,
} from '../../api/ticket-messages.api';
import type { PendingAttachment, RejectedAttachment } from './attachment-screening';

/**
 * Sube los archivos que quedaron en el `FileDropZone` una vez que el mensaje ya
 * existe (el `messageId` va en la URL de la subida, así que antes no hay dónde
 * colgarlos).
 *
 * Existe para que las dos pantallas no escriban cada una su propio bucle: el
 * bucle ingenuo es un `Promise.all` cuyo primer rechazo tira el resto al suelo
 * sin decir cuál falló, y a partir de ahí el usuario tiene medio mensaje subido
 * y ningún motivo en pantalla.
 *
 * Aquí, en cambio:
 *
 * - **De uno en uno y en orden.** El servidor suma el presupuesto del ticket
 *   por subida; en paralelo, dos subidas pueden pasar las dos por la
 *   comprobación (carrera documentada y aceptada en el backend). En serie el
 *   corte cae donde debe, y de paso el orden de los adjuntos en el hilo es el
 *   que eligió el usuario.
 * - **Un fallo que solo habla de un archivo no detiene a los demás.** Que uno
 *   se pase de tamaño no es motivo para no subir los otros cuatro.
 * - **Un fallo que habla del ticket sí los detiene**, y los que quedan se
 *   marcan como no intentados. Ver `isTerminal`.
 * - **Cada fallo se cuenta con su nombre y su código.** El mensaje es el del
 *   backend, que ya distingue el tipo (415) del tamaño (413) y ya viene en
 *   español; aplanarlos a un «no se pudieron subir los adjuntos» es
 *   exactamente lo que deja al usuario sin saber qué arreglar.
 */
export interface AttachmentUploader<T> {
  uploadAttachment: (ticketId: number, messageId: number, file: File) => Promise<T>;
}

export interface UploadOutcome<T> {
  uploaded: T[];
  /** Los que el servidor rechazó, con su motivo. */
  failed: RejectedAttachment[];
  /** Los que ni se llegaron a mandar porque el anterior cerró la puerta para todos. */
  skipped: RejectedAttachment[];
}

export async function uploadPendingAttachments<T>(
  uploader: AttachmentUploader<T>,
  ticketId: number,
  messageId: number,
  pending: readonly PendingAttachment[],
): Promise<UploadOutcome<T>> {
  const uploaded: T[] = [];
  const failed: RejectedAttachment[] = [];
  const skipped: RejectedAttachment[] = [];

  for (let index = 0; index < pending.length; index++) {
    const item = pending[index];

    try {
      uploaded.push(await uploader.uploadAttachment(ticketId, messageId, item.file));
      continue;
    } catch (error) {
      const described = await describeAttachmentError(error);
      failed.push({
        id: item.id,
        filename: item.file.name,
        code: described.code,
        message: withFilename(item.file.name, described.message),
      });

      if (!isTerminal(described, item)) continue;

      // Lo que queda no se manda. Mandarlo sería subir hasta 90 MB por la red
      // garantizados a fallar, uno a uno, para que el servidor conteste lo
      // mismo cada vez -- con la conexión del usuario pagándolo y la pantalla
      // llenándose de copias del mismo mensaje.
      for (const rest of pending.slice(index + 1)) {
        skipped.push({
          id: rest.id,
          filename: rest.file.name,
          code: 'NOT_ATTEMPTED',
          message: `«${rest.file.name}» no se llegó a enviar: ${reasonForSkipping(described)}`,
        });
      }
      break;
    }
  }

  return { uploaded, failed, skipped };
}

/**
 * ¿El rechazo habla de **este** archivo, o del ticket entero?
 *
 * Solo los dos primeros dependen del archivo; con cualquiera de los demás, el
 * siguiente recibiría exactamente la misma respuesta:
 *
 * - `UNSUPPORTED_MEDIA_TYPE` — es de este archivo. Se sigue.
 * - `PAYLOAD_TOO_LARGE` — **depende**, y esta es la parte delicada, porque el
 *   backend usa el mismo código para dos cortes distintos: el tope por archivo
 *   (`assertAcceptable`) y el presupuesto acumulado del ticket
 *   (`assertClientBudget`). No hay que leer el texto para distinguirlos: el
 *   tope por archivo **solo puede dispararlo un archivo que pase de
 *   `MAX_FILE_BYTES`**, y ese dato lo tenemos aquí. Así que un 413 sobre un
 *   archivo que cabe holgadamente solo puede venir del presupuesto del ticket,
 *   que además nunca baja: los siguientes tampoco entrarían.
 * - `CONFLICT` — el ticket está cerrado. No se abre entre un archivo y el
 *   siguiente.
 * - `NOT_FOUND` — el mensaje o el ticket no existen para quien pregunta. Los
 *   demás cuelgan del mismo mensaje.
 * - `UNAUTHORIZED` / `FORBIDDEN` — la sesión. Idem.
 * - `NETWORK_ERROR` — no hubo respuesta. Insistir nueve veces con archivos de
 *   megabytes no es reintentar, es castigar una conexión que ya falla.
 *
 * Cualquier código que no se reconozca **no** detiene el bucle: ante la duda se
 * intenta, que es el lado en el que equivocarse solo cuesta una petición.
 */
function isTerminal(error: AttachmentError, item: PendingAttachment): boolean {
  if (error.code === 'PAYLOAD_TOO_LARGE') {
    // Cabía por tamaño propio, así que lo que se agotó es el presupuesto del ticket.
    return item.file.size <= MAX_FILE_BYTES;
  }

  const terminal: AttachmentErrorCode[] = [
    'CONFLICT',
    'NOT_FOUND',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NETWORK_ERROR',
  ];
  return terminal.includes(error.code);
}

/** Por qué no se intentó, dicho en corto y sin repetir el mensaje largo del backend. */
function reasonForSkipping(error: AttachmentError): string {
  switch (error.code) {
    case 'PAYLOAD_TOO_LARGE':
      return 'el ticket ya no admite más archivos adjuntos.';
    case 'CONFLICT':
      return 'el ticket ya no admite adjuntos nuevos.';
    case 'NETWORK_ERROR':
      return 'se perdió la conexión con el servidor.';
    default:
      return 'el envío anterior falló por un motivo que afecta a todos.';
  }
}

/**
 * El nombre del archivo, delante.
 *
 * La mayoría de los mensajes del backend ya lo llevan (`assertAcceptable` lo
 * interpola), pero no todos: el 413 que corta multer antes de leer el cuerpo
 * habla de «el archivo» en abstracto porque a esas alturas no tiene el nombre.
 * Se antepone solo cuando falta, para no acabar diciéndolo dos veces.
 */
function withFilename(filename: string, message: string): string {
  return message.includes(filename) ? message : `«${filename}»: ${message}`;
}
