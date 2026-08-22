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
 * Exige un veredicto explicito (`spf=pass` o `dkim=pass`) con limite de
 * palabra en los dos lados, para que una subcadena dentro de otra palabra
 * (p. ej. "passed" en un comentario de la propia cabecera) nunca cuente
 * como un pase.
 */
const AUTH_PASS_PATTERN = /\b(?:spf|dkim)=pass\b/i;

/**
 * Juzga la cabecera `Authentication-Results` **mas externa** (la que anade
 * nuestro propio servidor de entrada, la unica en la que se puede confiar --
 * cualquier cabecera con ese nombre mas adentro de la cadena de `Received`
 * la pudo escribir el propio remitente). Quien llama es responsable de
 * pasar esa, y solo esa.
 *
 * Devuelve `PASA` si aparece `spf=pass` o `dkim=pass` (basta uno: exigir los
 * dos a la vez rechazaria remitentes legitimos cuyo proveedor solo firma con
 * DKIM, o cuyo SPF se rompe por un reenvio intermedio). Devuelve `FALLA` si
 * la cabecera esta presente pero ninguno de los dos aparece. Devuelve
 * `SIN_CABECERA` si no hay cabecera que juzgar -- `null`, `undefined`, o una
 * cadena en blanco, que es como llega cuando el correo no trae la cabecera
 * en absoluto.
 */
export function judgeAuthentication(topmostHeader: string | null | undefined): AuthVerdict {
  if (topmostHeader == null || topmostHeader.trim().length === 0) return 'SIN_CABECERA';
  return AUTH_PASS_PATTERN.test(topmostHeader) ? 'PASA' : 'FALLA';
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
