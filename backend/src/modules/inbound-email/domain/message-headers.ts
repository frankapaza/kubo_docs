/**
 * Analisis de cabeceras y asunto de un correo entrante. Dominio puro: texto
 * entrando, texto (o booleanos) saliendo. Sin base de datos, sin red, sin
 * inyeccion de dependencias, y sin importar nada del resto del proyecto.
 */

/**
 * Un identificador de mensaje, tal como aparece en `Message-ID`,
 * `In-Reply-To` o `References`. RFC 5322 §3.6.4 lo define entre corchetes
 * angulares (`<...>`), pero algunos clientes los omiten al escribir
 * `In-Reply-To`. Normalizamos siempre a la forma con corchetes para que
 * comparar dos identificadores despues sea una igualdad de cadenas, y no una
 * comparacion con reglas repetidas en cada sitio que compare.
 */
function normalizeMessageId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
  return `<${trimmed}>`;
}

/**
 * Extrae los identificadores de mensaje de una cabecera `In-Reply-To` o
 * `References`, en el orden en que aparecen. `References` puede traer varios
 * separados por espacios o saltos de linea (con continuacion de cabecera
 * plegada); `In-Reply-To` normalmente trae uno solo.
 *
 * `null`, `undefined` o una cadena en blanco no son un identificador
 * ausente-que-cuenta-como-otra-cosa: son la ausencia de la cabecera, y
 * devuelven una lista vacia.
 */
export function parseMessageIds(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  // Los identificadores no llevan espacios internos, asi que partir por
  // espacios en blanco (incluidos los saltos de linea del plegado de
  // cabeceras) los separa sin ambiguedad.
  return trimmed
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map(normalizeMessageId);
}

/**
 * Un prefijo de respuesta o reenvio, tal como lo anteponen distintos
 * clientes de correo. "RV:" es el que usan clientes en espanol para
 * "reenviado". La lista no distingue mayusculas al comparar.
 */
const SUBJECT_PREFIX_PATTERN = /^\s*(re|rv|fwd|fw)\s*:\s*/i;

/**
 * Quita del asunto los prefijos de respuesta/reenvio acumulados
 * (`Re: Re: Fwd: ...`), aplicando el patron repetidamente hasta que deje de
 * haber uno. No distingue mayusculas ni exige que los dos puntos peguen a la
 * palabra ("re :" tambien cuenta), pero no toca una palabra que solo se
 * parece ("Revision...") porque el patron exige los dos puntos.
 */
export function stripSubjectPrefixes(subject: string): string {
  let result = subject;
  let previous: string;
  do {
    previous = result;
    result = result.replace(SUBJECT_PREFIX_PATTERN, '');
  } while (result !== previous);
  return result;
}

/** Un codigo de ticket entre corchetes, p. ej. `[KB-1234]`. */
const TICKET_CODE_PATTERN = /\[(KB-\d+)\]/g;

/**
 * Busca un codigo de ticket (`KB-1234`) en el asunto, entre corchetes.
 * Si aparece mas de uno, devuelve `null` en vez de adivinar cual es el
 * correcto: eso pasa cuando alguien reenvia una conversacion que mezcla dos
 * hilos, y acertar por casualidad el ticket equivocado es peor que abrir uno
 * nuevo -- que es lo que ocurre igualmente si no se encuentra ninguno.
 */
export function extractTicketCode(subject: string): string | null {
  const matches = [...subject.matchAll(TICKET_CODE_PATTERN)];
  if (matches.length !== 1) return null;
  return matches[0][1];
}

/**
 * Cabeceras que, cuando estan presentes (con cualquier valor salvo la
 * excepcion explicita de `auto-submitted`), delatan un mensaje generado por
 * una maquina y no escrito por una persona.
 */
const AUTOMATIC_HEADER_KEYS = ['precedence', 'x-auto-response-suppress', 'list-id'] as const;

/**
 * Decide si un mensaje es automatico (respuesta de "fuera de la oficina",
 * lista de correo, notificacion de un sistema...) a partir de sus cabeceras.
 *
 * **Supuesto de la firma**: `headers` debe llegar con las claves ya en
 * minuscula. Las cabeceras de correo no distinguen mayusculas
 * (`Auto-Submitted` y `auto-submitted` son la misma cabecera), pero quien
 * arme este objeto puede no haber normalizado eso -- este modulo no lo hace
 * por quien llama, y leer con una clave en otra capitalizacion simplemente
 * no encontraria nada.
 *
 * `Auto-Submitted: no` es, por RFC 3834, el valor que identifica un correo
 * escrito por una persona -- es el valor por defecto que un servidor
 * cumplidor antepone. Tratar su sola presencia como automatico silenciaria
 * respuestas legitimas de clientes cuyo servidor si anade la cabecera.
 */
export function isAutomaticMessage(headers: Record<string, string | undefined>): boolean {
  const autoSubmitted = headers['auto-submitted'];
  if (autoSubmitted !== undefined && autoSubmitted.trim().toLowerCase() !== 'no') {
    return true;
  }

  return AUTOMATIC_HEADER_KEYS.some((key) => headers[key] !== undefined);
}
