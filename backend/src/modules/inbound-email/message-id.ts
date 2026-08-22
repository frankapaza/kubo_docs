import { createHash } from 'crypto';

/**
 * El identificador que va a `inbound_emails.message_id` (y a sus columnas
 * hermanas `tickets.email_message_id` y `ticket_events.sent_message_id`,
 * todas `CHARACTER SET ascii` e indexadas para la correlación). Ver la
 * migración 021, sección 1, para el porqué completo del reparto entre esta
 * columna y `message_id_raw`.
 *
 * Vive junto a `InboundEmail` -- la entidad que distingue las dos columnas --
 * y no en `domain/`: aquello es gramática de cabeceras de correo (extraer,
 * parsear, correlacionar referencias); esto es una decisión de
 * almacenamiento, sobre qué se puede meter en una columna `ascii`.
 *
 * **Todo lo que lea `inbound_emails.message_id`, `tickets.email_message_id` o
 * `ticket_events.sent_message_id` -- incluido
 * `InboundEmailsRepository.findByMessageId` y los `messageIds` que recibe
 * `findTicketsByEmailMessageIds` -- espera el valor ya pasado por esta
 * función, nunca el `Message-ID` crudo tal cual llegó en la cabecera.**
 * Compararlo sin normalizar rompe la idempotencia de la ingesta (un
 * `Message-ID` no-ASCII no encontraría nunca su duplicado) y la correlación
 * de respuestas (nunca encontraría el ticket).
 *
 * Si el `Message-ID` crudo ya es ASCII -- el caso abrumador, RFC 5322 §3.6.4
 * -- se guarda tal cual: es el valor con el que de verdad hay que
 * correlacionar, y no hay nada que traducir.
 *
 * Si no lo es -- el correo internacionalizado de RFC 6532 lo permite, y es
 * válido por norma, no un correo corrupto -- insertarlo tal cual en una
 * columna `ascii` bajo el modo estricto de MySQL 8 rechaza la fila entera, y
 * la columna es `NOT NULL`: no habría ningún valor que guardar. El sustituto
 * es un hash **determinista** del valor crudo, no uno aleatorio: tiene que
 * dar el mismo resultado en cada intento para que la clave única sobre esta
 * columna siga detectando el mismo correo si la ingesta se reinicia a medias
 * -- esa es la idempotencia que sostiene toda la tabla.
 *
 * El prefijo `sha256:` no es parte del hash: es lo que permite reconocer a
 * simple vista, leyendo la tabla, que ese valor es un sustituto y no el
 * `Message-ID` que envió nadie -- un `<...>` de verdad no empieza así -- y
 * apunta a quien lo mire hacia `message_id_raw` para ver el original.
 */
export function normalizeMessageId(raw: string): string {
  if (isAscii(raw)) return raw;
  const hash = createHash('sha256').update(raw, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/** Todo el valor cabe en el rango US-ASCII de siete bits (RFC 5322 §3.6.4). */
function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 127) return false;
  }
  return true;
}
