/**
 * Recorte del texto citado al final de un correo, para no repetir en cada
 * mensaje del hilo toda la conversacion anterior. Dominio puro.
 */

/**
 * Linea de atribucion tipica antes de una cita ("... escribio:" en clientes
 * en espanol, "... wrote:" en ingles). No exige que la linea empiece de una
 * forma concreta ("El...", "On...") porque el formato exacto varia entre
 * clientes de correo; el final de la linea ya es una senal suficientemente
 * rara como para no confundirse con una frase normal.
 */
const ATTRIBUTION_PATTERN = /\b(escribi[oó]|wrote)\s*:\s*$/i;

/** Separador clasico de Outlook antes del mensaje reenviado o respondido. */
const SEPARATOR_PATTERN = /^-+\s*(mensaje original|original message)\s*-+$/i;

/**
 * Una linea cuenta como marcador de cita si es una linea de atribucion, un
 * separador de Outlook, o el principio de un bloque citado con `>`.
 */
function isMarkerLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('>')) return true;
  if (ATTRIBUTION_PATTERN.test(trimmed)) return true;
  if (SEPARATOR_PATTERN.test(trimmed)) return true;
  return false;
}

/**
 * Recorta de `body` la cita del mensaje anterior, si la encuentra.
 *
 * Busca, linea a linea, la primera que sea a la vez (a) un marcador
 * conocido y (b) el principio de un bloque -- es decir, la primera linea
 * del cuerpo, o la primera linea despues de una linea en blanco. Esa
 * segunda condicion es la que evita el falso positivo: una linea que
 * empieza por `>` en mitad de una frase util (p. ej. citando un mensaje de
 * error) no esta precedida por una linea en blanco, asi que no cuenta como
 * el principio de una cita y no se recorta nada.
 *
 * Si no encuentra ningun marcador en esa posicion, devuelve `body` sin
 * tocar. Si lo encuentra pero el resultado, una vez recortado el espacio
 * sobrante, queda vacio -- el caso extremo de un mensaje que es cita de
 * principio a fin, sin una sola linea propia -- tambien devuelve `body` sin
 * tocar: un mensaje vacio en el hilo es una burbuja en blanco que el
 * cliente ve y no entiende, y ante esa duda se prefiere de mas.
 */
export function stripQuotedText(body: string): string {
  const lines = body.split(/\r\n|\r|\n/);

  for (let i = 0; i < lines.length; i++) {
    const isBlockStart = i === 0 || lines[i - 1].trim() === '';
    if (isBlockStart && isMarkerLine(lines[i])) {
      const kept = lines.slice(0, i).join('\n').trim();
      return kept.length > 0 ? kept : body;
    }
  }

  return body;
}
