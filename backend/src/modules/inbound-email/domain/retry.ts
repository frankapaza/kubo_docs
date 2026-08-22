import { PERU_TIME_ZONE } from '../../../common/time-zone';

/**
 * El texto de un reintento (Task 9, pantalla de correo entrante). Dominio
 * puro: construye los dos valores que `InboundEmailService.retry` escribe en
 * la fila ya reencolada, sin tocar el buzón ni la base de datos.
 *
 * **El reintento no reprocesa, re-encola.** El correo sigue en el buzón --
 * `markProcessed` solo pone una bandera IMAP, no borra ni mueve nada -- así
 * que no hace falta guardar ni volver a leer su contenido: basta con liberar
 * la clave única de `inbound_emails.message_id` (renombrando la fila) y con
 * quitarle la bandera en el buzón (`Mailbox.markUnprocessed`) para que el
 * lector de cada minuto la vuelva a procesar por el camino de siempre, con
 * una fila nueva. La fila vieja **no se borra ni cambia de `outcome`**: sigue
 * siendo el rastro de que ese intento concreto falló, que es el propósito
 * entero de esta tabla.
 */

/** Límite de la columna `inbound_emails.message_id` (migración 021, RFC 5322 §2.1.1). */
export const MESSAGE_ID_COLUMN_MAX_LENGTH = 998;

/**
 * El nuevo `message_id` de una fila en `ERROR` que se reencola.
 *
 * Lleva tres cosas, siempre en el mismo orden -- el original, el id de la
 * fila y el instante -- por tres motivos distintos:
 *
 * - **El original**, para que la fila siga siendo legible como "esto era tal
 *   correo" sin tener que ir a buscar el motivo.
 * - **El id de la fila**, para que dos reintentos casi simultáneos sobre la
 *   misma fila (dos pestañas, un doble clic que burlara el freno del
 *   navegador) no puedan producir el mismo valor -- dos filas con el mismo
 *   `message_id` chocarían contra la clave única que este mismo mecanismo
 *   existe para esquivar.
 * - **El instante**, para poder leer de un vistazo, sin abrir el motivo,
 *   cuándo se liberó esta fila.
 *
 * **Se recorta el original si hace falta, nunca el sufijo.** El sufijo es lo
 * que hace visible que esta fila ya fue reencolada; recortarlo dejaría un
 * valor ambiguo o, peor, dos filas distintas recortadas al mismo valor. Un
 * `message_id` original ya en el límite de la columna es rarísimo (los
 * clientes de correo generan identificadores de sobra más cortos que 998
 * caracteres), pero la columna sí lo permite, así que se cubre.
 */
export function buildRequeuedMessageId(originalMessageId: string, rowId: number, at: Date): string {
  const suffix = `#reintento-${rowId}-${at.getTime()}`;
  const budgetForOriginal = MESSAGE_ID_COLUMN_MAX_LENGTH - suffix.length;
  const truncatedOriginal =
    budgetForOriginal > 0 && originalMessageId.length > budgetForOriginal
      ? originalMessageId.slice(0, budgetForOriginal)
      : originalMessageId;
  return `${truncatedOriginal}${suffix}`;
}

/**
 * Fecha y hora en español y en hora de Perú, con la zona escrita -- mismo
 * criterio que `portal-reports.service.ts` (`formatPeruDateTime`): el
 * backend corre en `TZ=UTC`, y este texto lo va a leer una persona en la
 * pantalla de correo entrante, así que tiene que llevar la zona de negocio,
 * no la del proceso. Este proyecto ya lleva cinco fallos de zona horaria;
 * este es el único punto donde el reintento escribe una fecha en texto, y no
 * se le exime de la regla por ser "solo un motivo interno".
 */
function formatPeruDateTime(instant: Date): string {
  const texto = new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: PERU_TIME_ZONE,
  }).format(instant);
  return `${texto} (hora de Perú)`;
}

/**
 * El motivo actualizado de una fila que se reencola: el original **se
 * conserva**, con la nota del reintento añadida debajo. Borrar por qué falló
 * la primera vez para dejar solo "se reencoló" perdería precisamente el dato
 * que alguien viene a buscar a esta pantalla -- es la caja negra de la
 * ingesta, y una caja negra que se reescribe a sí misma no sirve para nada.
 */
export function appendRequeuedReason(originalReason: string | null, actorEmail: string, at: Date): string {
  const nota = `Reencolado el ${formatPeruDateTime(at)} por ${actorEmail} para volver a procesarse.`;
  const original = originalReason?.trim();
  return original ? `${original}\n\n${nota}` : nota;
}
