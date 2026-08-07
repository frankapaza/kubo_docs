import { describeAttachmentError } from '../../api/ticket-messages.api';
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
 * - **Un fallo no detiene a los demás.** Que un archivo se pase de tamaño no es
 *   motivo para no subir los otros cuatro.
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
  failed: RejectedAttachment[];
}

export async function uploadPendingAttachments<T>(
  uploader: AttachmentUploader<T>,
  ticketId: number,
  messageId: number,
  pending: readonly PendingAttachment[],
): Promise<UploadOutcome<T>> {
  const uploaded: T[] = [];
  const failed: RejectedAttachment[] = [];

  for (const item of pending) {
    try {
      uploaded.push(await uploader.uploadAttachment(ticketId, messageId, item.file));
    } catch (error) {
      const described = await describeAttachmentError(error);
      failed.push({
        id: item.id,
        filename: item.file.name,
        code: described.code,
        message: withFilename(item.file.name, described.message),
      });
    }
  }

  return { uploaded, failed };
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
