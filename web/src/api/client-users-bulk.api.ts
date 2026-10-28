import { api } from './client';
import { saveAttachmentToDisk } from './ticket-messages.api';

/**
 * La carga masiva de usuarios de cliente, desde el panel.
 *
 * **El navegador no analiza nada.** Descarga bytes y sube bytes; quien lee la
 * hoja de cálculo, valida y decide es el servidor (decisión 1 del diseño). Aquí
 * no hay ninguna regla de negocio que pudiera divergir de la suya.
 */

/**
 * Los veredictos, **en una lista y no solo en un tipo**.
 *
 * Esta lista es una copia de la del backend (`BULK_ROW_VERDICTS` en
 * `client-users-bulk.service.ts`), y la copia es inevitable: el panel y la API
 * son dos proyectos de TypeScript distintos y el fichero del backend arrastra
 * medio Nest. Lo que sí deja de ser inevitable es que diverjan en silencio:
 * hay una prueba del backend (`bulk-users-contrato-web.spec.ts`) que lee ESTE
 * fichero y falla si las dos listas dejan de decir lo mismo.
 *
 * El tipo sale de la lista, no al revés. Así, añadir un veredicto aquí rompe
 * la compilación de todo lo que lo pinta —los `Record<BulkRowVerdict, …>` de
 * `BulkInviteDialog`— en vez de dejar una etiqueta vacía y una clase de estilo
 * que dice «undefined».
 */
export const BULK_ROW_VERDICTS = ['SE_INVITARA', 'SE_REINVITARA', 'RECHAZADA'] as const;

export type BulkRowVerdict = (typeof BULK_ROW_VERDICTS)[number];

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
  /**
   * Hasta cuándo vale la revisión, en hora de Lima y **ya escrito por el
   * backend**: normalmente `HH:MM`, y con el día detrás cuando la media hora
   * cruza la medianoche. Se pinta tal cual; aquí no se formatea nada.
   */
  expiresAtLabel: string;
}

/** Los finales del envío. Misma lista cotejada, mismo motivo que arriba. */
export const BULK_SEND_OUTCOMES = [
  'INVITADA',
  'INVITADA_SIN_CORREO',
  'OMITIDA',
  'FALLO',
] as const;

export type BulkSendOutcome = (typeof BULK_SEND_OUTCOMES)[number];

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

/**
 * El nombre que el servidor pide para el fichero, o `null` si no lo dice.
 *
 * Solo la forma con comillas, que es la que escribe este backend (el nombre es
 * ASCII por construcción, así que no hay `filename*` de la RFC 5987 que leer).
 * Se queda con el último segmento tras `/` o `\`: un nombre con ruta dentro no
 * puede llegar de nuestro servidor, pero `download` lo interpretaría, y esto
 * cuesta una línea.
 */
function nombreDelServidor(headers: unknown): string | null {
  const cabecera = (headers as Record<string, unknown> | undefined)?.['content-disposition'];
  if (typeof cabecera !== 'string') return null;
  const encontrado = /filename="([^"]+)"/i.exec(cabecera)?.[1];
  if (!encontrado) return null;
  const limpio = encontrado.split(/[/\\]/).pop();
  return limpio ? limpio : null;
}

/**
 * El mismo error, con el cuerpo legible donde la pantalla lo busca.
 *
 * Con `responseType: 'blob'`, axios deja también el cuerpo del ERROR como
 * `Blob`, y `toErrorList` solo sabe leer `{ message, details }`. Aquí se
 * deshace ese binario a JSON y se devuelve el error tal cual, para que quien
 * lo reciba no tenga que saber que esta petición era binaria.
 */
async function conErrorLegible(e: unknown): Promise<unknown> {
  const error = e as { response?: { data?: unknown } };
  const data = error?.response?.data;
  if (!(data instanceof Blob)) return e;

  try {
    error.response!.data = JSON.parse(await data.text());
  } catch {
    // No era JSON (un HTML de un proxy, bytes sueltos): se deja sin cuerpo y
    // que hable el texto genérico, que es la verdad — no sabemos qué pasó.
    error.response!.data = undefined;
  }
  return e;
}

export const clientUsersBulkApi = {
  /**
   * Descarga la plantilla y la guarda. `saveAttachmentToDisk` y no un `<a>`
   * suelto: ahí vive el `revokeObjectURL`.
   *
   * **El nombre del fichero lo manda el servidor**, en `Content-Disposition`.
   * Antes estaba escrito también aquí, y los dos coincidían de milagro: el día
   * que cambiara el del backend, el panel seguiría guardando el viejo sin que
   * nada fallara. El de respaldo no es la misma copia —solo existe para que la
   * descarga no se quede sin nombre si un proxy borra la cabecera— y por eso es
   * genérico a propósito.
   *
   * **El error se traduce antes de salir.** Se pide como binario, así que un
   * rechazo del servidor llega como binario y el lector de errores de la
   * pantalla no encuentra nada que leer: acababa enseñando «no se pudo
   * completar la operación» en vez del motivo, que para un 403 o un 401 es
   * justo lo que hay que decir.
   */
  downloadTemplate: async (): Promise<void> => {
    let res;
    try {
      res = await api.get<Blob>('/client-users/carga-masiva/plantilla', {
        responseType: 'blob',
      });
    } catch (e) {
      throw await conErrorLegible(e);
    }
    saveAttachmentToDisk(res.data, nombreDelServidor(res.headers) ?? 'plantilla.xlsx');
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
