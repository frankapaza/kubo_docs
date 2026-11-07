import { truncateText } from './ingest-batch';
import { PERU_UTC_OFFSET_MINUTES } from '../../../common/peru-month';

/**
 * Ventana de aceptación de la hora de un evento.
 *
 * Loki rechaza muestras de más de 7 días o del futuro; si el reloj del
 * servidor del cliente va desfasado, el envío fallaría para siempre y el
 * appender reintentaría sin fin. Por eso lo que cae fuera se guarda con la
 * hora de recepción (y la original queda aparte, para no perder el dato).
 */
export const MAX_EVENT_AGE_MS = 7 * 24 * 3600 * 1000;
export const MAX_EVENT_FUTURE_MS = 5 * 60 * 1000;

/** Tope de la hora original que se conserva: es una cadena ajena, puede ser enorme. */
const MAX_ORIGINAL_CHARS = 64;

/**
 * Solo ISO 8601 con zona explícita (Z o ±hh:mm). Sin zona, Date.parse
 * interpreta la hora en la zona del proceso (UTC en producción, Lima en
 * desarrollo) y el mismo evento tendría dos instantes distintos.
 */
const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * Decide con qué instante se registra un evento.
 *
 * `original` solo viene informado cuando se SUSTITUYÓ la hora, para que
 * quien lea la línea sepa que `ts` es la de recepción y no la del evento.
 */
export function resolveEventTime(
  rawTs: unknown,
  receivedAt: Date,
): { at: Date; original: string | null } {
  if (typeof rawTs === 'string' && ISO_CON_ZONA.test(rawTs)) {
    const ms = Date.parse(rawTs);
    if (
      Number.isFinite(ms) &&
      ms >= receivedAt.getTime() - MAX_EVENT_AGE_MS &&
      ms <= receivedAt.getTime() + MAX_EVENT_FUTURE_MS
    ) {
      return { at: new Date(ms), original: null };
    }
  }
  let original: string;
  try {
    original = typeof rawTs === 'string' ? rawTs : String(rawTs);
  } catch {
    original = '';
  }
  return { at: receivedAt, original: truncateText(original, MAX_ORIGINAL_CHARS) };
}

/**
 * Día civil de Perú (`YYYY-MM-DD`) de un instante.
 *
 * Los conteos diarios se agrupan por día peruano. Se calcula desplazando el
 * instante con el desfase fijo y leyendo los campos UTC, así el resultado no
 * depende de la zona del proceso (producción UTC, desarrollo América/Lima).
 */
export function peruDay(instant: Date): string {
  const shifted = new Date(instant.getTime() + PERU_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}
