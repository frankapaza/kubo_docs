import { api } from './client';
import { saveAttachmentToDisk } from './ticket-messages.api';

/**
 * La carga masiva de usuarios de cliente, desde el panel.
 *
 * **El navegador no analiza nada.** Descarga bytes y sube bytes; quien lee la
 * hoja de cálculo, valida y decide es el servidor (decisión 1 del diseño). Aquí
 * no hay ninguna regla de negocio que pudiera divergir de la suya.
 */

export type BulkRowVerdict = 'SE_INVITARA' | 'SE_REINVITARA' | 'RECHAZADA';

export interface BulkReviewRow {
  /** Fila del archivo, contando la cabecera. Es lo que deja ir a corregirla. */
  line: number;
  fullName: string;
  email: string;
  verdict: BulkRowVerdict;
  /** El motivo, escrito por el servidor. Se muestra tal cual, sin tocarlo. */
  reason: string | null;
}

export interface BulkReviewResult {
  clientId: number;
  clientName: string;
  rows: BulkReviewRow[];
  totals: { willInvite: number; willReinvite: number; rejected: number };
  /**
   * Bloque opaco con lo aprobado. **Se devuelve verbatim al confirmar**: no lo
   * decodifiques, no lo reordenes y no lo vuelvas a serializar. Su firma se
   * calcula sobre esta cadena tal cual. Cadena vacía si no hay nada que confirmar.
   */
  revision: string;
  /** Su firma. Se devuelve verbatim, igual. */
  mac: string;
  /** Hasta cuándo vale la revisión (HH:MM, hora de Lima), ya formateado por el backend. */
  expiresAtLabel: string;
}

export type BulkSendOutcome = 'INVITADA' | 'INVITADA_SIN_CORREO' | 'OMITIDA' | 'FALLO';

export interface BulkSendRow {
  line: number;
  fullName: string;
  email: string;
  outcome: BulkSendOutcome;
  reason: string | null;
}

export interface BulkSendResult {
  clientId: number;
  rows: BulkSendRow[];
  totals: { invited: number; invitedWithoutEmail: number; skipped: number; failed: number };
}

export const clientUsersBulkApi = {
  /**
   * Descarga la plantilla y la guarda. `saveAttachmentToDisk` y no un `<a>`
   * suelto: ahí vive el `revokeObjectURL`.
   */
  downloadTemplate: async (): Promise<void> => {
    const res = await api.get<Blob>('/client-users/carga-masiva/plantilla', {
      responseType: 'blob',
    });
    saveAttachmentToDisk(res.data, 'plantilla-usuarios-portal.xlsx');
  },

  /** Sube el archivo y devuelve qué pasaría. **No manda ningún correo.** */
  review: (clientId: number, file: File): Promise<BulkReviewResult> => {
    const form = new FormData();
    form.append('file', file);
    // El `clientId` va en la query, no en el formulario (lo valida `ParseIntPipe`).
    return api
      .post<BulkReviewResult>('/client-users/carga-masiva/revision', form, { params: { clientId } })
      .then((r) => r.data);
  },

  /**
   * Confirma y manda los correos. `revision` y `mac` van **verbatim**, tal como
   * llegaron. El `clientId` también va en la query —el controlador lo exige con
   * `ParseIntPipe` y lo coteja con la empresa firmada dentro del bloque—, y se
   * toma de la propia revisión (`BulkReviewResult.clientId`), no de la página.
   */
  send: (clientId: number, revision: string, mac: string): Promise<BulkSendResult> =>
    api
      .post<BulkSendResult>(
        '/client-users/carga-masiva/envio',
        { revision, mac },
        { params: { clientId } },
      )
      .then((r) => r.data),
};
