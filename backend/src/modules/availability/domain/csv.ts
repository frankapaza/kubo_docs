/**
 * Escape de celdas CSV a prueba de inyección de fórmulas; espejo de
 * `web/src/lib/csv.ts` (ver allí el razonamiento). Una celda que empieza por
 * `= + - @ \t \r \n` (o espacios y luego uno de ellos) lleva un apóstrofo
 * delante; los números puros pasan intactos.
 */
const PURE_NUMBER = /^-?\d+(?:[.,]\d+)?\s?%?$/;

export function neutralizeFormula(v: string): string {
  if (PURE_NUMBER.test(v)) return v;
  if (/^[\t\r\n]/.test(v) || /^\s*[=+\-@]/.test(v)) return `'${v}`;
  return v;
}

export function csvEscape(v: string): string {
  return `"${neutralizeFormula(v).replace(/"/g, '""')}"`;
}

/** CSV UTF-8 con BOM, `;` como separador y CRLF (Excel en español). */
export function toCsv(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => cells.map(csvEscape).join(';');
  return '\uFEFF' + [header, ...rows].map(line).join('\r\n') + '\r\n';
}
