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
 * Un marcador de atribucion largo, cuando Gmail lo envuelve, deja el inicio
 * (fecha, remitente...) en una o mas lineas previas sin punto final, y solo
 * la palabra "escribio:"/"wrote:" en la ultima. Para no dejar ese principio
 * de la atribucion como si fuera contenido propio del cliente, se extiende
 * el punto de corte hacia atras mientras la linea anterior (a) no este en
 * blanco y (b) no termine en puntuacion de cierre de frase -- lo que
 * delataria que es una oracion completa e independiente, no la continuacion
 * envuelta de la misma atribucion.
 */
function expandAttributionStart(lines: string[], markerIndex: number): number {
  let start = markerIndex;
  while (start > 0) {
    const previous = lines[start - 1].trim();
    if (previous.length === 0) break;
    if (/[.!?:;]$/.test(previous)) break;
    start--;
  }
  return start;
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
      const restIsQuotedTerritory = lines.slice(i).every((candidate) => isQuotedTerritory(classifyLine(candidate)));
      if (!restIsQuotedTerritory) continue;
      cutAt = kind === 'attribution' ? expandAttributionStart(lines, i) : i;
    }
  }

  if (cutAt === -1) return body;

  const kept = lines.slice(0, cutAt).join('\n').trim();
  return kept.length > 0 ? kept : body;
}
