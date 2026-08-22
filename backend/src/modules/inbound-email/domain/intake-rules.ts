/**
 * Reglas de aceptacion de un correo entrante: si el remitente esta
 * autenticado, y si la direccion de origen es el propio buzon del sistema
 * (para no crear un ticket a partir de un correo que el propio sistema
 * mando y que un reenvio o una regla de copia le devolvio). Dominio puro.
 */

/**
 * El veredicto de autenticacion de un correo, con **tres** valores y no dos.
 *
 * `SIN_CABECERA` es la razon de ser de este modulo: si el servidor de correo
 * no anade `Authentication-Results`, la ausencia no significa "probablemente
 * bien" -- significa que no hay ninguna garantia de que el remitente sea
 * quien dice ser, y sin esa garantia no debe entrar ningun correo. Separarlo
 * de `FALLA` importa para quien opera el sistema: "el remitente fallo la
 * autenticacion" (un ataque, o un servidor de origen mal configurado) y
 * "nuestro servidor no esta anadiendo la cabecera" (un fallo de
 * configuracion nuestro) son dos problemas de naturaleza distinta, y el
 * registro tiene que poder decir cual de los dos esta ocurriendo.
 */
export type AuthVerdict = 'PASA' | 'FALLA' | 'SIN_CABECERA';

/**
 * Un comentario `(...)` de RFC 5322/8601. Puede contener texto arbitrario
 * que escoge el remitente (p. ej. el motivo de un fallo de SPF), y por eso
 * nunca debe leerse buscando un veredicto dentro: es la superficie de
 * ataque mas obvia de "busca la subcadena en cualquier parte".
 */
const COMMENT_PATTERN = /\([^()]*\)/g;

/**
 * Un resultado al principio de un segmento: un identificador (el metodo,
 * `spf`/`dkim`, u otra clave que no nos interesa) seguido de `=` -- con
 * espacios opcionales a los dos lados, que RFC 8601 permite -- y un valor.
 *
 * El identificador y el valor comparten la misma forma de token
 * (`[A-Za-z][A-Za-z0-9-]*`) capturada **entera**: si el valor real es
 * `pass-nada`, el grupo se queda con `pass-nada` completo y no con el
 * prefijo `pass`, así que compararlo por igualdad exacta contra `"pass"`
 * rechaza correctamente un valor que solo empieza como un veredicto pero no
 * lo es.
 */
const RESULT_AT_SEGMENT_START = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*([A-Za-z][A-Za-z0-9-]*)/;

/**
 * Decide si `header` trae un veredicto `pass` autentico para `method`
 * (`spf` o `dkim`), analizando la gramática de RFC 8601 en vez de buscar
 * una subcadena.
 *
 * `Authentication-Results` **no es texto de confianza de punta a punta**:
 * nuestro propio servidor copia dentro de ella datos que escribe el
 * remitente -- `smtp.mailfrom`, `smtp.helo`, `header.from`, y el texto libre
 * de los comentarios. `"spf=pass@atacante.net"` es una direccion de correo
 * valida (RFC 5322 permite `=` en la parte local), y quien la registra
 * consigue que *nuestro* servidor escriba `spf=pass` dentro de
 * `smtp.mailfrom` aunque el SPF real sea `fail`. Buscar la subcadena
 * `spf=pass` en cualquier parte de la cabecera cae directo en esa trampa.
 *
 * La cabecera tiene la forma "identificador-del-servidor; resultado;
 * resultado; ...", con cada resultado como `metodo=veredicto` seguido de
 * sus propios pares `clave=valor` (p. ej. `smtp.mailfrom=...`). **Un
 * veredicto solo cuenta si esta al principio de su propio segmento** --
 * nunca si aparece dentro del valor de otra clave del mismo segmento, que
 * es exactamente donde el remitente puede escribir lo que quiera.
 *
 * Pasos:
 * 1. Quitar los comentarios (`replace`) antes de nada: as[i] un comentario
 *    que diga literalmente "dkim=pass" nunca llega a analizarse como tal.
 * 2. Partir por `;` y descartar el primer trozo (`slice(1)`): es el
 *    identificador del servidor que firmo la cabecera, no un resultado.
 * 3. En cada segmento restante, exigir que el patron case **anclado al
 *    principio** (`^`): eso descarta cualquier `metodo=valor` que aparezca
 *    mas adentro del segmento, como el `spf=pass` incrustado dentro de
 *    `smtp.mailfrom=spf=pass@atacante.net`.
 */
function hasPassingResult(header: string, method: 'spf' | 'dkim'): boolean {
  const withoutComments = header.replace(COMMENT_PATTERN, ' ');
  const segments = withoutComments.split(';').slice(1);

  return segments.some((segment) => {
    const match = RESULT_AT_SEGMENT_START.exec(segment);
    if (!match) return false;
    const [, seenMethod, verdict] = match;
    return seenMethod.toLowerCase() === method && verdict.toLowerCase() === 'pass';
  });
}

/**
 * Juzga la cabecera `Authentication-Results` **mas externa** (la que anade
 * nuestro propio servidor de entrada, la unica en la que se puede confiar --
 * cualquier cabecera con ese nombre mas adentro de la cadena de `Received`
 * la pudo escribir el propio remitente). Quien llama es responsable de
 * pasar esa, y solo esa.
 *
 * Devuelve `PASA` si aparece un veredicto autentico `spf=pass` o
 * `dkim=pass` (basta uno: exigir los dos a la vez rechazaria remitentes
 * legitimos cuyo proveedor solo firma con DKIM, o cuyo SPF se rompe por un
 * reenvio intermedio). Devuelve `FALLA` si la cabecera esta presente pero
 * ninguno de los dos aparece. Devuelve `SIN_CABECERA` si no hay cabecera
 * que juzgar -- `null`, `undefined`, o una cadena en blanco, que es como
 * llega cuando el correo no trae la cabecera en absoluto.
 */
export function judgeAuthentication(topmostHeader: string | null | undefined): AuthVerdict {
  if (topmostHeader == null || topmostHeader.trim().length === 0) return 'SIN_CABECERA';
  const passes = hasPassingResult(topmostHeader, 'spf') || hasPassingResult(topmostHeader, 'dkim');
  return passes ? 'PASA' : 'FALLA';
}

/**
 * Decide si `fromAddress` es el propio buzon del sistema (`mailboxAddress`).
 * Comparacion exacta, sin distinguir mayusculas -- las direcciones de correo
 * no las distinguen en la parte del dominio, y en la practica tampoco en la
 * parte local de la inmensa mayoria de proveedores. Exacta y no "contiene",
 * porque `ticket@kuboti.com.atacante.net` no es `ticket@kuboti.com`: es un
 * dominio distinto que un atacante registra a proposito para que la
 * subcadena engañe a una comprobacion menos estricta.
 */
export function isOwnMailbox(fromAddress: string, mailboxAddress: string): boolean {
  return fromAddress.trim().toLowerCase() === mailboxAddress.trim().toLowerCase();
}
