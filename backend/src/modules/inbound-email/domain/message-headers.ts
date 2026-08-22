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

/** Un identificador ya entre corchetes angulares, tal como RFC 5322 lo define. */
const BRACKETED_MESSAGE_ID_PATTERN = /<[^>]+>/g;

/**
 * Extrae los identificadores de mensaje de una cabecera `In-Reply-To` o
 * `References`, en el orden en que aparecen. `References` puede traer varios
 * separados por espacios, saltos de linea (con continuacion de cabecera
 * plegada) o comas -- las tres formas existen en la practica.
 *
 * Primero se buscan identificadores ya entre corchetes con una expresion
 * regular: eso los separa correctamente sin importar que el separador entre
 * ellos sea un espacio o una coma, porque la coma nunca forma parte de un
 * identificador y el patron simplemente la deja fuera de cada coincidencia.
 * Partir primero por espacios (como hacia la version anterior) rompia
 * `'<a@x>,<b@x>'` en un solo token con la coma pegada, que ya no es un
 * identificador valido y no volveria a coincidir con nada.
 *
 * Solo si no aparece ningun identificador entre corchetes se cae al criterio
 * anterior (partir por espacios o comas y normalizar cada trozo): es el caso
 * de un cliente que escribe uno o mas identificadores sin corchetes en
 * absoluto. Esta rama de respaldo tenia el mismo problema que la principal
 * (ronda de correcciones 2): partia solo por espacios, asi que
 * `'a@x,b@x'` se quedaba en un unico token `'a@x,b@x'` con la coma pegada.
 * Partir tambien por comas la deja igual de correcta que la rama principal.
 *
 * `null`, `undefined` o una cadena en blanco no son un identificador
 * ausente-que-cuenta-como-otra-cosa: son la ausencia de la cabecera, y
 * devuelven una lista vacia.
 */
export function parseMessageIds(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  const bracketed = trimmed.match(BRACKETED_MESSAGE_ID_PATTERN);
  if (bracketed && bracketed.length > 0) return bracketed;

  return trimmed
    .split(/[\s,]+/)
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
 * Si aparece mas de un codigo DISTINTO, devuelve `null` en vez de adivinar
 * cual es el correcto: eso pasa cuando alguien reenvia una conversacion que
 * mezcla dos hilos, y acertar por casualidad el ticket equivocado es peor
 * que abrir uno nuevo -- que es lo que ocurre igualmente si no se encuentra
 * ninguno.
 *
 * Cuenta codigos **unicos**, no apariciones: un asunto acumulado por
 * reenvios sucesivos repite el mismo codigo varias veces
 * (`"Fwd: [KB-1234] Fwd: [KB-1234] ..."`), y eso no es una mezcla de
 * conversaciones -- es la misma conversacion, reenviada mas de una vez.
 * Contar apariciones en vez de codigos distintos forzaria un ticket nuevo
 * justo en el caso que este modulo existe para evitar: que la respuesta de
 * un cliente continue su propio ticket.
 */
export function extractTicketCode(subject: string): string | null {
  const matches = [...subject.matchAll(TICKET_CODE_PATTERN)];
  const uniqueCodes = new Set(matches.map((match) => match[1]));
  if (uniqueCodes.size !== 1) return null;
  return matches[0][1];
}

/**
 * La direccion de correo desnuda de una cabecera `From`, sin el nombre para
 * mostrar que RFC 5322 §3.4 permite delante (`mailbox = name-addr / addr-spec`,
 * y `name-addr` es justo "un nombre y una direccion entre `<>`"). Asi es como
 * llega la inmensa mayoria de las veces -- es la misma razon por la que
 * `EmailService` ya trae su propio extractor para el remitente de nuestros
 * propios envios (`extractEmail`, en `modules/email/email.service.ts`) -- y
 * no una forma rara de cabecera.
 *
 * Sin desenvolverla, ninguna comparacion por direccion puede funcionar nunca:
 * `isOwnMailbox('"Soporte Kuboti" <ticket@kuboti.com>', 'ticket@kuboti.com')`
 * compararia un nombre completo contra una direccion y siempre daria `false`,
 * y lo mismo le pasaria a cualquier busqueda de remitente por correo. Es
 * exactamente el defecto general del proyecto en su forma de cabecera: decidir
 * por una cadena que *contiene* el hecho en vez de por el hecho mismo.
 *
 * Se recorta y se pasa a minusculas: el dominio de un correo nunca distingue
 * mayusculas, y la parte local tampoco lo hace en la inmensa mayoria de
 * proveedores -- el mismo criterio que ya aplican `isOwnMailbox` y
 * `ClientUsersRepository.findByEmail`.
 *
 * Si no hay ningun `<...>`, se asume que `from` ya es la direccion (el otro
 * caso legitimo de la gramatica, `addr-spec` a secas) y solo se normaliza.
 */
export function extractSenderAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  const address = match ? match[1] : from;
  return address.trim().toLowerCase();
}

/**
 * Valores de `Precedence` que identifican correo generado por una maquina.
 * `normal` y `first-class` son, igual que `Auto-Submitted: no`, los valores
 * que la cabecera define para correo escrito por una persona -- decidir por
 * la sola presencia de la clave, sin mirar cual de los dos tipos de valor
 * trae, confundiria exactamente ese caso con el opuesto.
 */
const AUTOMATIC_PRECEDENCE_VALUES = new Set(['bulk', 'list', 'junk']);

/**
 * Cabeceras cuya sola presencia (con un valor no vacio) delata un mensaje
 * automatico, porque a diferencia de `precedence` no tienen un valor
 * definido para "esto lo escribio una persona": la propia cabecera solo
 * existe quien la automatiza.
 */
const AUTOMATIC_PRESENCE_KEYS = ['x-auto-response-suppress', 'list-id'] as const;

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
 * Cada cabecera se juzga por lo que **dice**, nunca por el solo hecho de
 * estar presente -- es el mismo defecto en su forma general: decidir por la
 * ausencia (o, aqui, por la presencia bruta) de un dato en vez de por el
 * hecho que ese dato realmente determina.
 *
 * - `Auto-Submitted: no` es, por RFC 3834, el valor que identifica un
 *   correo escrito por una persona -- es el valor por defecto que un
 *   servidor cumplidor antepone. Cualquier otro valor no vacio
 *   (`auto-replied`, `auto-generated`, ...) es automatico. Un valor en
 *   blanco no es "no" ni ningun tipo de automatizacion reconocido: no es
 *   evidencia de nada, igual que un `List-Id` en blanco tampoco lo es
 *   (ronda de correcciones 2: antes esta cabecera era la unica excepcion a
 *   la regla de "valor no vacio" que las otras tres ya cumplian).
 * - `Precedence` tiene la misma dualidad: `bulk`, `list` y `junk` son
 *   automaticos; `normal` y `first-class` (o cualquier otro valor) son
 *   correo de persona.
 * - `X-Auto-Response-Suppress` y `List-Id` no tienen un valor reservado
 *   para "correo de persona": si estan presentes con un valor no vacio, la
 *   cabecera misma es la senal.
 */
export function isAutomaticMessage(headers: Record<string, string | undefined>): boolean {
  const autoSubmitted = headers['auto-submitted'];
  if (autoSubmitted !== undefined) {
    const value = autoSubmitted.trim().toLowerCase();
    if (value.length > 0 && value !== 'no') return true;
  }

  const precedence = headers['precedence'];
  if (precedence !== undefined && AUTOMATIC_PRECEDENCE_VALUES.has(precedence.trim().toLowerCase())) {
    return true;
  }

  return AUTOMATIC_PRESENCE_KEYS.some((key) => {
    const value = headers[key];
    return value !== undefined && value.trim().length > 0;
  });
}
