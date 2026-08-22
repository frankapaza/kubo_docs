/**
 * Analisis de cabeceras y asunto de un correo entrante. Dominio puro: texto
 * entrando, texto (o booleanos) saliendo. Sin base de datos, sin red, sin
 * inyeccion de dependencias, y sin importar nada del resto del proyecto.
 *
 * `domainToASCII` es la unica excepcion a "sin importar nada del resto del
 * proyecto": es un modulo nativo de Node (`node:url`), no una dependencia de
 * este proyecto, y sigue siendo una funcion pura y determinista -- no abre
 * ninguna conexion ni consulta nada.
 */
import { domainToASCII } from 'node:url';

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
 *
 * **No aplicar esto sobre una direccion que un analizador de verdad ya
 * resolvio** (p. ej. `IncomingMessage.from`, que desde la ronda de
 * correcciones 2 de la Task 8 llega ya resuelta por `mailparser`). El
 * regex de arriba no entiende que un local-part entrecomillado puede
 * contener su propio `<...>` sin que sea un nombre para mostrar
 * (`"<jefe@kuboti.com>"@evil.com` es una direccion valida por RFC 5322), y
 * volver a aplicarlo ahi tomaba ese `<...>` interno como si envolviera la
 * direccion real -- ver el docblock de `ImapMailboxService` (punto 2) para
 * el vector completo. Hoy esta funcion solo se usa sobre valores de
 * configuracion de confianza (el usuario IMAP de los ajustes,
 * `inbound-email.module.ts`), no sobre nada que un remitente controle.
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

/**
 * Divide una direccion ya resuelta en su parte local y su dominio, por el
 * **ultimo** `@` de la cadena -- ver `domainOf` para el porque exacto de
 * "ultimo y no primero". `null` si no hay ningun `@`.
 */
function splitAddress(address: string): { localPart: string; domain: string } | null {
  const at = address.lastIndexOf('@');
  if (at === -1) return null;
  return { localPart: address.slice(0, at), domain: address.slice(at + 1) };
}

/**
 * Normaliza un dominio ya extraido (nunca una direccion completa) a su forma
 * codificada ASCII (punycode, RFC 3490/5890) -- la misma forma en la que un
 * servidor de correo escribe `header.from=` en `Authentication-Results`
 * (RFC 8601 exige ASCII-compatible encoding ahi).
 *
 * **Ronda de correcciones final de la Task 9: el octavo intento contra la
 * suplantacion, y el primero que no es un ataque sino un correo legitimo
 * descartandose solo.** El cruce de dominios que cierra el septimo intento
 * (`extractAuthenticatedDomain` vs `domainOf`, ver el docblock de esa
 * funcion) compara dos cadenas de texto -- y `mailparser` decodifica un
 * dominio internacionalizado (IDN, RFC 5891) de la cabecera `From` de forma
 * **inconsistente**: SI lo decodifica a caracteres nacionales cuando es el
 * dominio de nivel superior y va en minuscula (`xn--e1afmkfd.com` ->
 * `пример.com`), pero NO lo decodifica si va en un subdominio
 * (`foo.xn--e1afmkfd.com` se queda igual) ni si va en mayuscula
 * (`XN--E1AFMKFD.COM` tambien se queda igual). El servidor de correo, en
 * cambio, escribe SIEMPRE la forma codificada en `header.from=`. El
 * resultado, sin esta funcion: para cualquier cliente cuyo dominio sea un
 * IDN de nivel superior en minuscula, `domainOf(message.from)` da la forma
 * con caracteres nacionales mientras `extractAuthenticatedDomain` da la
 * forma codificada -- dos representaciones del MISMO dominio que nunca son
 * iguales como cadena -- y el cruce del septimo intento, que existe
 * precisamente para proteger al cliente legitimo, lo descarta a el en su
 * lugar. **Siempre, y sin ningun error visible**: el correo simplemente
 * nunca llega, y nada en los logs lo distingue de un intento de suplantacion
 * de verdad.
 *
 * Normalizar los dos lados a la forma codificada ANTES de comparar cierra
 * esto sin importar cual de las dos formas entrego `mailparser`, ni cual
 * escribio el servidor: las dos convergen al mismo punycode en minuscula.
 *
 * `null` si el dominio no es valido en absoluto (nunca una cadena vacia: es
 * la ausencia de dominio que comparar, el mismo criterio que ya usaba
 * `domainOf`).
 *
 * **Residuo de la ronda de cierre: el punto final de un FQDN no convergia.**
 * RFC 1035 SS3.1 permite un "." final para marcar un nombre de dominio
 * absoluto (`empresa.com.` y `empresa.com` son EL MISMO dominio) -- lo escribe
 * asi, por ejemplo, cualquier cosa que arme el nombre a partir de una consulta
 * DNS. `domainToASCII` no lo quita (`domainToASCII('empresa.com.')` da
 * `'empresa.com.'`, con el punto): sin recortarlo antes, un cliente cuyo
 * dominio llegara con el punto final por un lado del cruce (o de la busqueda
 * de remitente) y sin el por el otro se trataria como dos dominios distintos,
 * el mismo defecto de fondo que el resto de esta funcion existe para cerrar,
 * solo que por un camino distinto al de mayusculas/IDN. Se recorta como mucho
 * UN punto final -- un FQDN valido nunca lleva mas de uno -- antes de pedirle
 * a `domainToASCII` la forma codificada.
 */
export function normalizeDomain(domain: string): string | null {
  const trimmed = domain.trim();
  const withoutTrailingDot = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  const ascii = domainToASCII(withoutTrailingDot);
  return ascii.length > 0 ? ascii : null;
}

/**
 * El dominio de una direccion de correo ya resuelta, en su forma codificada
 * (ver `normalizeDomain`) -- todo lo que sigue al **ultimo** `@` de la
 * cadena. Es correcto para cualquier `addr-spec` valido de RFC 5322 sin
 * importar cuantos `@` traiga un local-part entre comillas (`"a@b"@dominio.com`
 * es una direccion legitima con `@` DENTRO del local-part): el dominio en si
 * nunca contiene un `@`, asi que el separador real entre local-part y
 * dominio es, por construccion, el ultimo `@` de la cadena entera -- no el
 * primero, que un local-part entrecomillado con `@` dentro haria apuntar al
 * sitio equivocado.
 *
 * Ronda de correcciones 2 de la Task 8: esta funcion existe para poder
 * comparar el dominio que DMARC certifico (`extractAuthenticatedDomain`,
 * `domain/intake-rules.ts`) contra el dominio de la direccion que el sistema
 * de verdad va a usar como remitente -- la unica comprobacion que cierra a
 * la vez los vectores que ya se conocian Y los que ni el propio analizador
 * de direcciones de `mailparser` acierta siempre: si los dos dominios no son
 * el mismo, el "pass" de DMARC no dice nada sobre ESTA direccion, la haya
 * extraido bien o mal cualquier analisis previo.
 *
 * `null` si no hay ningun `@` -- una direccion vacia o incompleta, no un
 * dominio vacio: no decidir por la ausencia, decidir por el hecho de que no
 * hay dominio que comparar.
 */
export function domainOf(address: string): string | null {
  const parts = splitAddress(address);
  if (!parts) return null;
  return normalizeDomain(parts.domain);
}

/**
 * `address`, con su dominio reescrito a la forma codificada (ver
 * `normalizeDomain`) -- la parte local no se toca. Cierra un reverso teorico
 * del mismo defecto que `normalizeDomain` corrige en el cruce de dominios: si
 * `message.from` se usara tal cual (con el dominio en caracteres nacionales,
 * como lo entrega `mailparser` para un IDN de nivel superior) para buscar al
 * cliente (`ClientUsersRepository.findByEmail`), la comparacion viajaria a
 * una columna MySQL cuya ordenacion por defecto **ignora los acentos**
 * (`_ai_`, accent-insensitive) -- de modo que un dominio genuinamente
 * distinto, pero que solo difiere de otro real en una tilde, podria
 * confundirse con el en esa busqueda. Reescribir el dominio a punycode antes
 * de que `message.from` se use para nada (busqueda de cliente, `isOwnMailbox`,
 * lo que se guarda en `inbound_emails.from_address`) elimina el acento del
 * todo: dos dominios punycode distintos nunca colapsan bajo una ordenacion
 * que ignora acentos, porque ninguno de los dos tiene ninguno.
 *
 * Deja `address` intacta si no tiene ningun `@`, o si su dominio no es valido
 * -- los mismos casos en los que `domainOf` ya devuelve `null` y en los que
 * no hay nada seguro que reescribir.
 */
export function withEncodedDomain(address: string): string {
  const parts = splitAddress(address);
  if (!parts) return address;
  const domain = normalizeDomain(parts.domain);
  return domain !== null ? `${parts.localPart}@${domain}` : address;
}
