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
 *
 * Puesta en marcha: comprobar solo que llega la cabecera no basta desde la
 * ronda de correcciones 2 (ver `judgeAuthentication`) -- hay que comprobar
 * ademas que llega con un segmento `dmarc=`. Si el proveedor de correo anade
 * `Authentication-Results` pero nunca corre DMARC, este modulo nunca vera
 * `SIN_CABECERA` (la cabecera SI llega) y todo correo dara `FALLA` en
 * silencio. Esa combinacion debe salir en cualquier comprobacion de salud de
 * la ingesta.
 */
export type AuthVerdict = 'PASA' | 'FALLA' | 'SIN_CABECERA';

/**
 * Tokeniza `header` en los segmentos de nivel superior separados por `;`,
 * respetando la gramatica de RFC 5322/8601: una `quoted-string` (`"..."`,
 * con `\` como escape) y un comentario (`(...)`, que **anida** y tambien usa
 * `\` como escape) pueden contener un `;` -- o un `(`, o un `"` -- que no
 * delimita nada; son parte del valor.
 *
 * Ronda de correcciones 2: la version anterior hacia
 * `header.replace(/\([^()]*\)/g, ' ').split(';')`, que falla en dos frentes
 * a la vez que el remitente controla:
 *
 * 1. **No conoce las `quoted-string`.** RFC 8601 define el valor de una
 *    propiedad como `token / quoted-string`, y un `;` dentro de una cadena
 *    entrecomillada (p. ej. `smtp.mailfrom="ana;dkim=pass"@atacante.net`,
 *    una direccion valida: RFC 5322 permite `;` en un local-part entre
 *    comillas) creaba un segmento nuevo que el ancla `^` de
 *    `RESULT_AT_SEGMENT_START` validaba sin más.
 * 2. **No anida comentarios.** RFC 5322 permite un comentario dentro de
 *    otro. `\([^()]*\)` solo reconoce el par mas interno; en
 *    `(razon: (detalle) ; dkim=pass )` solo borra `(detalle)`, deja el `(`
 *    externo huerfano sin reemplazar, y el resto de la cadena --incluido el
 *    `dkim=pass` falso-- queda como texto normal para el `split`.
 *
 * Un `split` sobre texto sin tokenizar no puede ser correcto aqui, sin
 * importar cuantos parches se le añadan: hace falta recorrer la cadena
 * carácter a carácter llevando la cuenta de si se está dentro de una
 * `quoted-string` o de la profundidad de comentarios, y partir solo por los
 * `;` que queden fuera de las dos cosas.
 *
 * **Malformación (comentario o cadena entrecomillada sin cerrar, o
 * paréntesis sin pareja): falla cerrado.** Todo lo que queda desde el punto
 * de la malformación hasta el final de la cabecera se descarta -- incluido
 * cualquier resultado genuino que hubiera venido despues. Es una perdida
 * aceptada a proposito: no hay forma de distinguir con certeza, a partir
 * solo del texto, "esto es un ataque" de "el servidor que compuso la
 * cabecera tiene un fallo de escape", y en los dos casos el texto que sigue
 * a la malformación no es de fiar.
 */
function splitTopLevelSegments(header: string): string[] {
  const segments: string[] = [];
  let current = '';
  let i = 0;
  const n = header.length;

  while (i < n) {
    const ch = header[i];

    if (ch === '"') {
      const quoted = consumeQuotedString(header, i);
      if (quoted === null) {
        // Sin cerrar: se descarta el resto de la cabecera (falla cerrado).
        i = n;
        break;
      }
      current += quoted.text;
      i = quoted.next;
      continue;
    }

    if (ch === '(') {
      const next = skipComment(header, i);
      if (next === null) {
        // Sin cerrar (o sin pareja, por anidamiento): igual, falla cerrado.
        i = n;
        break;
      }
      // El comentario entero es CFWS -- espacio en blanco semantico -- y se
      // reemplaza por un unico espacio, igual que hacia la version anterior
      // para el caso simple.
      current += ' ';
      i = next;
      continue;
    }

    if (ch === ';') {
      segments.push(current);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  segments.push(current);
  return segments;
}

/**
 * Consume una `quoted-string` que empieza en `s[start]` (`s[start] === '"'`).
 * `\X` dentro de las comillas escapa `X` literalmente (incluidas `"` y `\`
 * mismas), tal como define RFC 5322 §3.2.1 (`quoted-pair`).
 *
 * Devuelve `null` si no hay una comilla de cierre antes del final de `s`.
 */
function consumeQuotedString(s: string, start: number): { text: string; next: number } | null {
  let i = start + 1;
  let text = '"';
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      text += c + s[i + 1];
      i += 2;
      continue;
    }
    text += c;
    i++;
    if (c === '"') return { text, next: i };
  }
  return null;
}

/**
 * Salta un comentario que empieza en `s[start]` (`s[start] === '('`),
 * incluidos los que anida dentro (`(a (b) c)` es un solo comentario, no dos
 * separados). `\X` escapa `X` literalmente, igual que en una
 * `quoted-string`.
 *
 * Devuelve el indice justo despues del `)` que cierra el comentario **mas
 * externo**, o `null` si la profundidad nunca vuelve a cero antes del final
 * de `s` (sin cerrar, o con mas `(` que `)`).
 */
function skipComment(s: string, start: number): number | null {
  let depth = 1;
  let i = start + 1;
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      i += 2;
      continue;
    }
    if (c === '(') {
      depth++;
      i++;
      continue;
    }
    if (c === ')') {
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return depth === 0 ? i : null;
}

/**
 * Un resultado al principio de un segmento: un identificador (el metodo,
 * p. ej. `dmarc`, u otra clave que no nos interesa) seguido de `=` -- con
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
 * Decide si `header` trae un veredicto `pass` autentico para `method`,
 * tokenizando la cabecera con `splitTopLevelSegments` en vez de partir por
 * `;` a ciegas.
 *
 * La cabecera tiene la forma "identificador-del-servidor; resultado;
 * resultado; ...", con cada resultado como `metodo=veredicto` seguido de
 * sus propios pares `clave=valor` (p. ej. `smtp.mailfrom=...`). **Un
 * veredicto solo cuenta si esta al principio de su propio segmento de nivel
 * superior** -- nunca si aparece dentro del valor de otra clave, ni dentro
 * de una `quoted-string`, ni dentro de un comentario.
 */
function hasPassingResult(header: string, method: string): boolean {
  const segments = splitTopLevelSegments(header).slice(1);

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
 * **Ronda de correcciones 2, cambio de politica**: antes bastaba `spf=pass`
 * o `dkim=pass`. Eso deja un hueco que ningun analizador, por correcto que
 * sea, puede cerrar: un atacante que controla su propio dominio configura
 * DKIM (algo trivial), firma su propio correo, y pone `From:` de otra
 * empresa. `dkim=pass` es autentico -- el analizador no miente -- pero no
 * dice nada sobre si ese pase esta **alineado** con el dominio del `From:`.
 * El problema no es el analisis, es la politica: "autenticado" y
 * "autenticado como esta persona" no son lo mismo.
 *
 * Ahora se exige `dmarc=pass`. DMARC es exactamente el mecanismo disenado
 * para esto: por definicion, solo pasa si SPF o DKIM pasan **y ademas** el
 * dominio de esa comprobacion esta alineado con `From:`. Comprobar
 * `dmarc=pass` es mas simple y mas correcto que reimplementar la
 * comprobacion de alineación a mano a partir de `header.d=`/`header.i=`.
 *
 * Consecuencia aceptada a proposito: si el proveedor de correo no anade
 * `dmarc=` a la cabecera, no entra ningun correo (ver la nota sobre puesta
 * en marcha en `AuthVerdict`). Es coherente con el resto del diseño --
 * fallar cerrado, la ingesta nace apagada hasta que se demuestra que la
 * autenticacion esta configurada de verdad.
 *
 * Devuelve `SIN_CABECERA` si no hay cabecera que juzgar en absoluto --
 * `null`, `undefined`, o una cadena en blanco, que es como llega cuando el
 * correo no trae la cabecera. Si la cabecera SI llega pero no trae ningun
 * segmento `dmarc=` (o lo trae y no es `pass`), devuelve `FALLA`: la
 * cabecera existe, asi que no es "nuestro servidor no la anade" -- es "no
 * hay garantia de alineacion", que es la misma falta de garantia que un
 * `dmarc=fail` explicito, y merece la misma respuesta.
 */
export function judgeAuthentication(topmostHeader: string | null | undefined): AuthVerdict {
  if (topmostHeader == null || topmostHeader.trim().length === 0) return 'SIN_CABECERA';
  return hasPassingResult(topmostHeader, 'dmarc') ? 'PASA' : 'FALLA';
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
