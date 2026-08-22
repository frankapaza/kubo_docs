/**
 * Recorte del texto citado al final de un correo, para no repetir en cada
 * mensaje del hilo toda la conversacion anterior. Dominio puro.
 *
 * Ronda de correcciones 1: la version anterior decidia por "esta linea va
 * justo despues de una linea en blanco", que es el indicio, no el hecho.
 * Rompia en dos direcciones con correo real: Gmail pliega (envuelve) la
 * linea de atribucion cuando es larga, y entonces "escribio:" queda
 * precedido de texto (el resto de la propia atribucion envuelta), no de
 * blanco -- no disparaba nunca. Y al reves, un parrafo real en espanol que
 * termina en "escribio:" (describiendo algo que alguien anoto, no citando
 * un correo) SI iba precedido de una linea en blanco -- decapitaba un
 * mensaje legitimo del cliente.
 *
 * La regla que ataca el hecho en vez del indicio: cortar en el primer
 * marcador tal que, desde ahi hasta el final del cuerpo, todo sea linea
 * citada, marcador o linea en blanco. Eso es lo que de verdad distingue una
 * cita real (que ocupa el resto del mensaje) de una coincidencia de texto en
 * mitad de una frase util (a la que le sigue mas conversacion normal).
 */

/**
 * Linea de atribucion tipica antes de una cita ("... escribio:" en clientes
 * en espanol, "... wrote:" en ingles). No exige que la linea empiece de una
 * forma concreta ("El...", "On...") porque el formato exacto varia entre
 * clientes de correo, y porque Gmail puede envolverla dejando "escribio:"
 * solo en su propia linea. Es un marcador "debil": por si sola, esta frase
 * puede aparecer en una oracion cualquiera (ver `WEAK_MARKER_TYPES` mas
 * abajo), y solo cuenta si ademas se cumple que todo lo que sigue es cita.
 */
const ATTRIBUTION_PATTERN = /\b(escribi[oó]|wrote)\s*:\s*$/i;

/**
 * Separador clasico de Outlook en texto plano, antes del mensaje reenviado
 * o respondido.
 */
const OUTLOOK_DASH_SEPARATOR_PATTERN = /^-+\s*(mensaje original|original message)\s*-+$/i;

/**
 * La conversion de HTML a texto plano de Outlook moderno no siempre escribe
 * "-----Mensaje original-----": lo habitual es una raya larga de guiones
 * bajos, seguida de un bloque "De: / Enviado: / Para: / Asunto:". El umbral
 * de 8 evita que una raya corta de subrayado dentro de una firma cuente por
 * error.
 */
const UNDERSCORE_RULE_PATTERN = /^_{8,}$/;

/** Los tipos de linea que importan para decidir donde cortar. */
type LineKind = 'quote' | 'attribution' | 'strong' | 'blank' | 'other';

/**
 * Clasifica una linea. `'strong'` son los separadores explicitos
 * (guiones de Outlook clasico, raya de guiones bajos de Outlook moderno):
 * ninguna prosa normal los produce por accidente, asi que -- a diferencia
 * de `'attribution'` y `'quote'` -- no necesitan la comprobacion de "todo lo
 * que sigue es cita" para contar como el principio de la cita.
 */
function classifyLine(line: string): LineKind {
  const trimmed = line.trim();
  if (trimmed.length === 0) return 'blank';
  if (trimmed.startsWith('>')) return 'quote';
  if (OUTLOOK_DASH_SEPARATOR_PATTERN.test(trimmed) || UNDERSCORE_RULE_PATTERN.test(trimmed)) return 'strong';
  if (ATTRIBUTION_PATTERN.test(trimmed)) return 'attribution';
  return 'other';
}

/** `true` si esta linea puede formar parte del tramo citado (no es prosa nueva). */
function isQuotedTerritory(kind: LineKind): boolean {
  return kind !== 'other';
}

/**
 * El principio reconocible de un preambulo de atribucion envuelto: "El..."
 * (espanol) u "On..." (ingles), seguido de fecha/remitente/direccion. Es la
 * unica forma fiable de saber DONDE empieza una atribucion que Gmail
 * partio en varias lineas fisicas -- ver `expandAttributionStart`.
 */
const ATTRIBUTION_PREAMBLE_START_PATTERN = /^(el|on)\b/i;

/**
 * Ronda de correcciones 2, punto 3 (heuristica anterior, ya descartada):
 * "retrocede mientras la linea previa no acabe en puntuacion de cierre" se
 * aplicaba a **toda** atribucion, envuelta o no, y ninguna linea de una
 * firma (nombre, departamento, telefono) termina en esa puntuacion -- una
 * firma entera desaparecia detras de una atribucion que ni siquiera estaba
 * envuelta.
 *
 * Ronda de correcciones 3, punto 6 (esta version, tambien descartada antes
 * de esta): exigir que la linea marcadora fuera **solo** el verbo
 * ("escribio:" a solas) funcionaba para el plegado de dos lineas en el que
 * Gmail corta justo antes del verbo, pero el plegado real de Gmail no
 * siempre corta ahi -- lo habitual es que la direccion de correo (el
 * `<...>` de cierre) quede en la MISMA linea que el verbo
 * (`<ticket@kuboti.com> escribio:`), con el nombre y la fecha en una o mas
 * lineas anteriores. Esa forma no es "el verbo a solas", asi que la version
 * anterior no la reconocia y dejaba la primera linea de la atribucion
 * pegada al mensaje del cliente.
 *
 * **La condicion correcta es sobre donde EMPIEZA la atribucion, no sobre
 * como TERMINA la linea marcadora.** Se retrocede linea a linea, sin
 * limite de cuantas, mientras la linea marcadora (o la que se esta
 * evaluando) no sea ya el principio reconocible de una atribucion
 * (`ATTRIBUTION_PREAMBLE_START_PATTERN`, "El..."/"On..."):
 *
 * - Si la propia linea marcadora YA empieza por "El"/"On" (la atribucion
 *   cabe entera en una sola linea, envuelta o no por una firma), no hay
 *   nada que retroceder: el corte se queda ahi mismo.
 * - Si no, se retrocede una linea. Si esa linea empieza por "El"/"On", ahi
 *   esta el principio real de la atribucion: el corte se mueve a esa
 *   linea. Si no, y no esta en blanco, se sigue retrocediendo (para
 *   cubrir plegados de tres o mas lineas fisicas).
 * - Si se llega a una linea en blanco (o al principio del mensaje) sin
 *   haber encontrado un "El"/"On", no hay preambulo reconocible que
 *   recuperar: el corte se queda en la linea marcadora original, sin tocar
 *   lo anterior -- ese es el caso de una firma (u otro texto) que no forma
 *   parte de ninguna atribucion envuelta.
 */
function expandAttributionStart(lines: string[], markerIndex: number): number {
  const markerLine = lines[markerIndex].trim();
  if (ATTRIBUTION_PREAMBLE_START_PATTERN.test(markerLine)) return markerIndex;

  let start = markerIndex;
  while (start > 0) {
    const previous = lines[start - 1].trim();
    if (previous.length === 0) return markerIndex; // sin preambulo reconocible: no tocar nada anterior
    if (ATTRIBUTION_PREAMBLE_START_PATTERN.test(previous)) return start - 1;
    start--;
  }
  return markerIndex; // se llego al principio del mensaje sin encontrar "El"/"On"
}

/**
 * Recorta de `body` la cita del mensaje anterior, si la encuentra.
 *
 * Recorre las lineas en orden. Para cada una:
 * - Si es un marcador **fuerte** (separador de Outlook, clasico o moderno),
 *   corta ahi mismo: no hace falta validar nada mas.
 * - Si es un marcador **debil** (atribucion, o el principio de un bloque
 *   citado con `>`), solo corta si desde esa linea hasta el final del
 *   cuerpo no aparece ninguna linea de prosa normal -- es la comprobacion
 *   que distingue una cita real (que ocupa todo lo que resta del mensaje)
 *   de una coincidencia de texto a mitad de una frase util, a la que sigue
 *   mas conversacion.
 *
 * Si el marcador es una atribucion, el punto de corte se extiende hacia
 * atras con `expandAttributionStart` para no dejar suelto el principio de
 * una atribucion envuelta en varias lineas.
 *
 * Si no encuentra ningun marcador valido, devuelve `body` sin tocar. Si lo
 * encuentra pero el resultado, una vez recortado el espacio sobrante, queda
 * vacio -- un mensaje que es cita de principio a fin, sin una sola linea
 * propia -- tambien devuelve `body` sin tocar: un mensaje vacio en el hilo
 * es una burbuja en blanco que el cliente ve y no entiende, y ante esa duda
 * se prefiere de mas.
 */
export function stripQuotedText(body: string): string {
  const lines = body.split(/\r\n|\r|\n/);

  let cutAt = -1;

  for (let i = 0; i < lines.length && cutAt === -1; i++) {
    const kind = classifyLine(lines[i]);

    if (kind === 'strong') {
      cutAt = i;
      break;
    }

    if (kind === 'quote' || kind === 'attribution') {
      // Una atribucion existe para introducir una cita que viene DESPUES.
      // Si es la ultima linea del mensaje, no hay nada que introducir --
      // es, igual que el parrafo real de mas arriba, una frase que termina
      // asi por casualidad. (Un bloque `>` no tiene este problema: el
      // propio prefijo ya es, el solo, contenido citado.)
      if (kind === 'attribution' && i === lines.length - 1) continue;

      const restIsQuotedTerritory = lines.slice(i).every((candidate) => isQuotedTerritory(classifyLine(candidate)));
      if (!restIsQuotedTerritory) continue;
      cutAt = kind === 'attribution' ? expandAttributionStart(lines, i) : i;
    }
  }

  if (cutAt === -1) return body;

  const kept = lines.slice(0, cutAt).join('\n').trim();
  return kept.length > 0 ? kept : body;
}
