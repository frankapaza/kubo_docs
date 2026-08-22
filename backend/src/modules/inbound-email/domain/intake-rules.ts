/**
 * Reglas de aceptacion de un correo entrante: si el remitente esta
 * autenticado, y si la direccion de origen es el propio buzon del sistema
 * (para no crear un ticket a partir de un correo que el propio sistema
 * mando y que un reenvio o una regla de copia le devolvio). Dominio puro.
 */

/**
 * El veredicto de autenticacion de un correo, con **cuatro** valores.
 *
 * `SIN_CABECERA` es la razon de ser original de este modulo: si el servidor
 * de correo no anade `Authentication-Results` en absoluto, la ausencia no
 * significa "probablemente bien" -- significa que no hay ninguna garantia de
 * que el remitente sea quien dice ser, y sin esa garantia no debe entrar
 * ningun correo.
 *
 * `SIN_DMARC` (ronda de correcciones 3) separa una causa operativa mas: la
 * cabecera SI llega, pero sin ningun segmento `dmarc=` -- el proveedor de
 * correo no corre o no informa DMARC. Tiene el mismo efecto que `FALLA`
 * (no entra el correo) pero **un dueno y un alcance distintos**: se
 * arregla en la consola del proveedor, no aqui, y afecta al 100% del
 * trafico entrante a la vez, no a un remitente concreto. Es ademas el
 * fallo mas probable en la puesta en marcha, y el de sintoma mas confuso:
 * sin esta distincion, la bandeja se queda vacia sin una sola senal de por
 * que.
 *
 * `FALLA` es "el remitente (o su cabecera) no autentica" -- el remitente
 * fallo `dmarc`, o la cabecera muestra senales de haber sido manipulada
 * (ver `evaluateDmarc`). `SIN_CABECERA` y `SIN_DMARC` son, en cambio,
 * problemas de **nuestro** lado de la tuberia. Distinguir los tres separa
 * "el remitente fallo la autenticacion" de "nuestro servidor no anade la
 * cabecera" de "nuestro servidor no evalua DMARC" -- tres problemas de
 * naturaleza y de dueno distintos, y el registro tiene que poder decir cual
 * de los tres esta ocurriendo.
 */
export type AuthVerdict = 'PASA' | 'FALLA' | 'SIN_CABECERA' | 'SIN_DMARC';

/**
 * Un segmento de nivel superior, con su rango de caracteres `[start, end)`
 * en la cadena ORIGINAL (antes de quitar comentarios). Ese rango es lo que
 * permite, mas abajo, comprobar que ninguna aparicion cruda de `dmarc=`
 * cae fuera de el.
 */
interface TopLevelSegment {
  text: string;
  start: number;
  end: number;
}

/**
 * Tokeniza `header` en los segmentos de nivel superior separados por `;`,
 * respetando la gramatica de RFC 5322/8601: una `quoted-string` (`"..."`,
 * con `\` como escape) y un comentario (`(...)`, que anida y tambien usa
 * `\` como escape) pueden contener un `;` -- o un `(`, o un `"` -- que no
 * delimita nada; son parte del valor.
 *
 * **Ronda de correcciones 3 -- por que esto YA NO BASTA por si solo.** Un
 * comentario no reconoce comillas (RFC 5322: dentro de `ccontent` no hay
 * `quoted-string`, solo `ctext`/`quoted-pair`/comentario anidado). Un
 * remitente que controla su propia direccion de correo puede escribir un
 * local-part valido y entrecomillado como `"a); dmarc=pass; x"` -- RFC 5322
 * permite `)`, `;` y espacios dentro de un local-part entre comillas. Si
 * **nuestro propio servidor** interpola esa direccion sin re-escapar dentro
 * de un comentario boilerplate (el estilo habitual de Google, Microsoft y
 * rspamd: `spf=fail (google.com: domain of <direccion> does not
 * designate...) smtp.mailfrom=<direccion>`), el primer `)` del local-part
 * -- que dentro del comentario es un `)` normal y corriente, no el cierre
 * de ninguna comilla -- cierra el comentario **antes de tiempo**. Todo lo
 * que el servidor pretendia que siguiera dentro del comentario (el resto
 * del texto boilerplate, y el `)` genuino que lo cerraba) pasa a leerse
 * como estructura de nivel superior: el `; dmarc=pass;` que el remitente
 * inyecto en su propia direccion cae al principio de su propio segmento y
 * satisface el ancla de `RESULT_AT_SEGMENT_START` sin mas.
 *
 * **No se puede analizar correctamente una cadena cuyos delimitadores ya
 * falsifico el atacante aguas arriba.** El tokenizador de por si (comillas
 * y anidamiento de comentarios) sigue siendo correcto -- resiste comillas
 * escapadas, comentarios anidados a varios niveles, y todos los casos
 * limite de la ronda 2 -- pero la premisa de que "un comentario delimita un
 * comentario" deja de sostenerse cuando el contenido del comentario no es
 * el que el servidor penso que era. Por eso esta ronda anade dos cosas mas
 * (ver `evaluateDmarc`): cualquier malformacion invalida la cabecera
 * **entera**, no solo la cola; y una comprobacion sobre el texto crudo que
 * no depende de que el analisis estructural haya acertado.
 *
 * Reglas de malformacion (las tres devuelven `{ ok: false }`):
 * 1. Una `quoted-string` sin cerrar.
 * 2. Un comentario sin cerrar, o con mas `(` que `)` (anidamiento roto).
 * 3. **Un `)` a nivel superior, sin ningun `(` que lo abra.** Es la prueba
 *    directa de que el anidamiento se rompio en algun punto anterior --
 *    exactamente lo que deja el cierre prematuro descrito arriba: el `)`
 *    genuino del servidor, que ya no tiene con que emparejar, aparece
 *    "suelto" en cuanto el analisis vuelve a nivel superior.
 */
function splitTopLevelSegments(header: string): { ok: true; segments: TopLevelSegment[] } | { ok: false } {
  const segments: TopLevelSegment[] = [];
  let current = '';
  let segmentStart = 0;
  let i = 0;
  const n = header.length;

  while (i < n) {
    const ch = header[i];

    if (ch === '"') {
      const quoted = consumeQuotedString(header, i);
      if (quoted === null) return { ok: false };
      current += quoted.text;
      i = quoted.next;
      continue;
    }

    if (ch === '(') {
      const next = skipComment(header, i);
      if (next === null) return { ok: false };
      // El comentario entero es CFWS -- espacio en blanco semantico -- y se
      // reemplaza por un unico espacio.
      current += ' ';
      i = next;
      continue;
    }

    if (ch === ')') {
      // Sin un "(" que lo abra a este nivel: el anidamiento ya se rompio.
      return { ok: false };
    }

    if (ch === ';') {
      segments.push({ text: current, start: segmentStart, end: i });
      current = '';
      i++;
      segmentStart = i;
      continue;
    }

    current += ch;
    i++;
  }

  segments.push({ text: current, start: segmentStart, end: n });
  return { ok: true, segments };
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
 * **No reconoce comillas** -- fiel a RFC 5322: dentro de un comentario no
 * hay `quoted-string`, asi que un `"` aqui es un caracter normal y un `)`
 * sin escapar siempre cierra (o cierra un nivel de) el comentario, este o
 * no dentro de lo que, en otro contexto, se leeria como una cadena
 * entrecomillada. Ese es exactamente el mecanismo que un local-part como
 * `"a); dmarc=pass; x"` explota cuando aparece dentro de un comentario.
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
 *
 * Deliberadamente **no** valida el resto del segmento contra ninguna
 * gramatica mas estricta (p. ej. exigir que solo haya pares
 * `clave=valor` reconocidos despues): Microsoft emite
 * `dmarc=pass action=none`, donde `action` no es una clave de RFC 8601, y
 * exigir una forma completa rompería un proveedor real y legitimo.
 */
const RESULT_AT_SEGMENT_START = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*([A-Za-z][A-Za-z0-9-]*)/;

/**
 * Busca **todas** las apariciones crudas de `dmarc\s*=` en `header` (sin
 * tokenizar, sin distinguir mayusculas), con la posicion de cada una.
 */
function findRawDmarcMentions(header: string): number[] {
  const pattern = /dmarc\s*=/gi;
  const positions: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(header)) !== null) {
    positions.push(match.index);
  }
  return positions;
}

/** El resultado de evaluar el segmento `dmarc=` de la cabecera. */
type DmarcOutcome = 'PASS' | 'NOT_PASS' | 'ABSENT' | 'COMPROMISED';

/**
 * Evalua el resultado `dmarc` de `header` con tres capas, **las tres a la
 * vez** -- ronda de correcciones 3, ninguna basta sola:
 *
 * 1. **Tokenizar** con `splitTopLevelSegments`. Si la cabecera esta
 *    malformada (comentario/cadena sin cerrar, o un `)` suelto), el
 *    resultado es `COMPROMISED` **para la cabecera entera** -- no solo se
 *    descarta la cola desde el punto de la malformacion. Si se descartara
 *    solo la cola, un atacante podria colocar un `dmarc=pass` de mentira,
 *    ya bien formado, ANTES de una malformacion posterior (en un segmento
 *    sin relacion), y ese `dmarc=pass` ya se habria aceptado como valido
 *    antes de llegar al punto roto. Una cadena malformada no es de fiar en
 *    NINGUNA parte de si misma, precisamente porque no hay forma de saber,
 *    solo con texto, si la corrupcion fue accidental o deliberada -- ni de
 *    saber, si fue deliberada, donde mas actuo el remitente.
 * 2. **Contar los resultados `dmarc=` de nivel superior.** Cero es
 *    `ABSENT` (el proveedor no informa DMARC). Mas de uno es
 *    `COMPROMISED`: dos resultados de nivel superior nunca son legitimos a
 *    la vez -- ya sea porque uno es una inyeccion, ya sea porque son
 *    contradictorios (`dmarc=fail` y `dmarc=pass` a la vez, algo que un
 *    `.some()` habria dejado pasar como "alguno paso").
 * 3. **La defensa que no depende de acertar el analisis**: sobre el texto
 *    CRUDO de `header` (sin tokenizar), ninguna aparicion de `dmarc\s*=`
 *    puede caer fuera del rango `[start, end)` del unico segmento
 *    reconocido en el paso 2. Esto es deliberadamente independiente de si
 *    el tokenizador identifico correctamente por que esa mencion estaba
 *    ahi: si el remitente logro meter la palabra "dmarc=" en un
 *    comentario, en una cadena entrecomillada, o en cualquier valor -- y
 *    esta capa la encuentra fuera del segmento legitimo --, la cabecera ya
 *    no merece confianza, sin importar donde acabara esa mencion ni si el
 *    tokenizador la neutralizo bien. Es defensa en profundidad: detecta el
 *    intento en si, no el resultado de analizarlo.
 */
function evaluateDmarc(header: string): DmarcOutcome {
  const tokenized = splitTopLevelSegments(header);
  if (!tokenized.ok) return 'COMPROMISED';

  const rawMentions = findRawDmarcMentions(header);
  if (rawMentions.length === 0) return 'ABSENT';

  const resultSegments = tokenized.segments.slice(1); // descarta el identificador del servidor
  const dmarcMatches = resultSegments
    .map((segment) => ({ segment, match: RESULT_AT_SEGMENT_START.exec(segment.text) }))
    .filter(
      (entry): entry is { segment: TopLevelSegment; match: RegExpExecArray } =>
        entry.match !== null && entry.match[1].toLowerCase() === 'dmarc',
    );

  if (dmarcMatches.length !== 1) return 'COMPROMISED';

  const { segment, match } = dmarcMatches[0];
  const allMentionsInsideSegment = rawMentions.every((index) => index >= segment.start && index < segment.end);
  if (!allMentionsInsideSegment) return 'COMPROMISED';

  return match[2].toLowerCase() === 'pass' ? 'PASS' : 'NOT_PASS';
}

/**
 * Juzga la cabecera `Authentication-Results` de un correo.
 *
 * # Esto NO es la frontera de confianza -- es la segunda linea
 *
 * Ronda de correcciones 4: cinco elusiones seguidas contra esta funcion (dos
 * en la ronda 2, una en la ronda 3, dos mas aqui) dejan claro que defender
 * la aceptacion de un correo analizando texto que el propio remitente
 * puede influir, por bien que se analice ese texto, es defender en el
 * sitio equivocado. **La frontera de confianza real es la politica SMTP
 * del servidor de correo**: tiene que rechazar en el sobre, antes de
 * aceptar el mensaje, cualquier correo que no pase DMARC -- de forma que lo
 * unico que le llegue a esta funcion ya haya pasado, y no haga falta
 * analizar nada de lo que escribio el remitente.
 *
 * Esta funcion se queda como **defensa en profundidad**, no como la puerta.
 * Sigue mereciendo la pena: cierra el hueco de un `dkim=pass` autentico
 * pero no alineado (ronda 2), resiste comillas y comentarios bien formados
 * usados para esconder un veredicto falso (ronda 2), resiste que el propio
 * delimitador de un comentario se cierre antes de tiempo por una direccion
 * mal escapada (ronda 3), y ahora rechaza si la alimentan con mas de una
 * cabecera concatenada (mas abajo). Pero no puede ser la unica barrera.
 *
 * **Encender la ingesta de correo por este canal EXIGE haber verificado
 * que esa politica de rechazo en SMTP esta configurada y activa en el
 * servidor de correo real.** Sin ella, `SIN_DMARC` seguira bloqueando el
 * caso feliz (el proveedor no informa DMARC en absoluto), pero el vector
 * residual de abajo queda abierto.
 *
 * ## Un vector residual que este analisis NO PUEDE detectar
 *
 * ```
 * mx.kubo.com; spf=fail smtp.helo=evil; dmarc=pass    ->  PASA (deberia ser FALLA)
 * ```
 *
 * Si el servidor de correo copia `smtp.helo` (u otro campo que el
 * remitente controle) en la cabecera **sin entrecomillarlo**, y el
 * remitente elige un valor que contiene un `;` sin escapar (aqui,
 * `evil; dmarc=pass` como HELO), el `;` crea un segmento de nivel superior
 * nuevo -- exactamente igual que si de verdad hubiera dos resultados
 * separados. No hay malformacion (nada se cierra mal), hay **exactamente
 * un** resultado `dmarc=`, y su unica mencion cruda cae dentro de su
 * propio segmento: las tres capas de `evaluateDmarc` lo aprueban
 * **correctamente segun la cadena que reciben**.
 *
 * El problema no es que el analisis sea flojo: es que **la cadena, una vez
 * serializada sin comillas, ya no contiene la informacion que hace falta
 * para decidir**. `"smtp.helo=evil; dmarc=pass"` con un `;` que separa dos
 * resultados de verdad, y `"smtp.helo=evil; dmarc=pass"` con un HELO que
 * por casualidad (o por ataque) contiene un punto y coma, son la MISMA
 * cadena de texto. Ninguna cantidad de analisis adicional sobre el texto
 * recupera una distincion que se perdio antes de que el texto llegara
 * aqui -- por eso el vector se deja documentado como limitacion conocida
 * (ver el test `LIMITACION CONOCIDA` en el spec) y no como un bug
 * pendiente: cerrarlo exige la politica SMTP de arriba, no mas codigo aqui.
 *
 * # El contrato de la cabecera que se pasa
 *
 * Debe ser la cabecera `Authentication-Results` **mas externa** (la que
 * anade nuestro propio servidor de entrada, la unica en la que se puede
 * confiar -- cualquier cabecera con ese nombre mas adentro de la cadena de
 * `Received` la pudo escribir el propio remitente), **y solo esa**.
 *
 * Ronda de correcciones 4, punto 1: ese contrato no puede vivir solo en
 * este parrafo. Cuando un correo pasa por varios saltos puede haber varias
 * cabeceras `Authentication-Results`; si un adaptador las concatena (algo
 * que RFC 5322 nunca pide, pero que un `join('\n')` descuidado puede
 * producir), el remitente puede anadir su PROPIA cabecera dentro de su
 * propio mensaje, con su propio `dmarc=pass` -- limpio, unico, sin ninguna
 * malformacion, porque es una cabecera autentica dentro de la cadena que
 * le llego a esta funcion. Ninguna de las tres capas de `evaluateDmarc`
 * detecta esto: no hay nada mal formado que detectar. Por eso la funcion
 * se niega a analizar cualquier valor que contenga un salto de linea
 * (`\n` o `\r`): una cabecera ya desplegada (unfolded, como llega tras un
 * parseo normal de RFC 5322) nunca deberia traer uno, y su presencia es la
 * prueba de que se concatenaron varias. No se intenta detectar "mas de una
 * cabecera" por ninguna otra via (p. ej. sin salto de linea, con espacio):
 * como ya demuestra el vector residual de arriba, esa distincion puede no
 * estar disponible en el texto en absoluto.
 *
 * Devuelve, en orden de prioridad:
 * - `SIN_CABECERA` si no hay cabecera que juzgar en absoluto -- `null`,
 *   `undefined`, o una cadena en blanco.
 * - `FALLA` si el valor contiene un salto de linea (`\n`/`\r`): senal de
 *   cabeceras concatenadas, ver arriba.
 * - `SIN_DMARC` si la cabecera llega pero no trae ningun rastro de
 *   `dmarc=` en ninguna parte del texto -- el proveedor no corre o no
 *   informa DMARC. Ver `AuthVerdict` para por que esto no es lo mismo que
 *   `FALLA`.
 * - `PASA` solo si hay **exactamente un** resultado `dmarc=` de nivel
 *   superior, ninguna otra mencion cruda de `dmarc=` fuera de el, y su
 *   veredicto es `pass`.
 * - `FALLA` en cualquier otro caso: el resultado no es `pass`, hay mas de
 *   un resultado, la cabecera esta malformada, o aparece `dmarc=` fuera
 *   del unico segmento legitimo.
 */
export function judgeAuthentication(topmostHeader: string | null | undefined): AuthVerdict {
  if (topmostHeader == null || topmostHeader.trim().length === 0) return 'SIN_CABECERA';
  if (/[\r\n]/.test(topmostHeader)) return 'FALLA';

  const outcome = evaluateDmarc(topmostHeader);
  if (outcome === 'PASS') return 'PASA';
  if (outcome === 'ABSENT') return 'SIN_DMARC';
  return 'FALLA'; // NOT_PASS o COMPROMISED
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
