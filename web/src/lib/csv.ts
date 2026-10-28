/**
 * Escape de celdas CSV, a prueba de inyeccion de formulas (CSV injection).
 *
 * Excel y Google Sheets evaluan como formula toda celda cuyo texto empieza por
 * `=`, `+`, `-` o `@`; las comillas que envuelven la celda NO lo impiden
 * (Excel las quita al importar y evalua lo que queda). `\t` y `\r` tambien
 * abren la puerta: hay hojas que los descartan al importar y evaluan lo que
 * sigue, y el `\n` inicial se trata igual por prudencia. Las celdas de estos
 * informes llevan asuntos y nombres que escribe gente de fuera, y el
 * documento se entrega como evidencia: nada puede ejecutarse al abrirlo.
 *
 * Neutralizacion: se antepone un apostrofo `'`. Excel y Sheets lo leen como
 * «esto es texto» y NO lo muestran, asi que lo que lee la persona no cambia.
 *
 * Casos:
 *  - Empieza por `= + - @ \t \r \n`            -> apostrofo.
 *  - Espacios (o NBSP, etc.) y luego `= + - @`  -> apostrofo: algunas hojas
 *    recortan el espacio antes de decidir si es formula, asi que no se
 *    confia en que el espacio lo proteja.
 *  - Numero o porcentaje puro (`12`, `-3`, `45%`, `-12,5 %`) -> SIN apostrofo.
 *    Es lo que el cliente suma en su hoja; con apostrofo pasaria a ser texto.
 *    Es seguro porque la exencion exige que TODA la celda sea digitos con
 *    signo `-` opcional: no hay nada ejecutable en ella, venga de donde
 *    venga. El `+` inicial NO se exime (`+5` puede ser formula; los
 *    numeros que genera el informe nunca lo llevan).
 *  - Fechas ya formateadas («05 oct 2026», «05/10/2026 14:30») no empiezan por
 *    ninguno de los caracteres peligrosos: pasan intactas.
 *  - «—» (raya) no es peligroso: pasa intacto.
 * No se tratan los equivalentes de ancho completo (＝ ＋ － ＠): Excel no los
 * evalua como formula.
 */
const PURE_NUMBER = /^-?\d+(?:[.,]\d+)?\s?%?$/;

export function neutralizeFormula(v: string): string {
  if (PURE_NUMBER.test(v)) return v;
  if (/^[\t\r\n]/.test(v) || /^\s*[=+\-@]/.test(v)) return `'${v}`;
  return v;
}

/** Celda CSV lista para escribir: neutralizada y entre comillas. */
export function csvEscape(v: string): string {
  return `"${neutralizeFormula(v).replace(/"/g, '""')}"`;
}
