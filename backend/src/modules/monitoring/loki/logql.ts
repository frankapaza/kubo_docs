import { LOG_LEVELS } from '../domain/log-level';
import { LogFilter } from '../domain/log-filter';

/**
 * Escapa un valor para ir entre comillas dobles en LogQL.
 *
 * `aplicativo` y `servidor` llegan de la query string y parseLogFilter conserva
 * comillas y barras: sin esto, un valor como `"} or {x="` cerraría el selector
 * e inyectaría otro (LogQL injection).
 */
export function escapeLogqlString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Escapa los metacaracteres de RE2 para buscar el texto tal cual, no como patrón. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Consulta LogQL de un filtro.
 *
 * El selector siempre lleva al menos un matcher no vacío (Loki rechaza
 * `{}`), por eso `instalacion=~".+"` cuando no se filtra por instalación.
 */
export function buildLogQuery(f: LogFilter): string {
  const m: string[] = [];
  m.push(
    f.instalacionId !== undefined
      ? `instalacion="${escapeLogqlString(String(f.instalacionId))}"`
      : 'instalacion=~".+"',
  );
  if (f.cliente !== undefined) m.push(`cliente="${escapeLogqlString(String(f.cliente))}"`);
  if (f.sistemaId !== undefined) m.push(`sistema="${escapeLogqlString(String(f.sistemaId))}"`);
  if (f.aplicativo) m.push(`aplicativo="${escapeLogqlString(f.aplicativo)}"`);
  if (f.servidor) m.push(`servidor="${escapeLogqlString(f.servidor)}"`);
  if (f.nivelMinimo) {
    // El orden de LOG_LEVELS es la gravedad.
    const niveles = LOG_LEVELS.slice(LOG_LEVELS.indexOf(f.nivelMinimo));
    m.push(`nivel=~"${niveles.join('|')}"`);
  }
  let q = `{${m.join(',')}}`;
  if (f.texto) {
    // Dos escapes: el de regex (la persona busca texto literal) y luego el de
    // la cadena LogQL que contiene esa regex.
    q += ` |~ "${escapeLogqlString('(?i)' + escapeRegex(f.texto))}"`;
  }
  return q;
}
