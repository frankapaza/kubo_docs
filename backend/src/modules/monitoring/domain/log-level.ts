/**
 * Niveles de log que entiende el monitoreo.
 *
 * Son los cinco de log4net/Loki. El orden del arreglo ES la gravedad: el
 * filtro de "nivel mínimo" compara por posición, así que no se reordena.
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export const LOG_LEVELS: readonly LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

/**
 * Alias de otros marcos de log (Serilog, syslog, java.util.logging...) que
 * un aplicativo puede mandar. Se mapean a los cinco niveles para que las
 * etiquetas de Loki tengan cardinalidad fija: un `nivel` libre las
 * multiplicaría sin control.
 */
const ALIAS: Record<string, LogLevel> = {
  TRACE: 'DEBUG',
  VERBOSE: 'DEBUG',
  ALL: 'DEBUG',
  NOTICE: 'INFO',
  WARNING: 'WARN',
  SEVERE: 'ERROR',
  CRITICAL: 'FATAL',
  ALERT: 'FATAL',
  EMERGENCY: 'FATAL',
};

/**
 * Lleva cualquier valor recibido a uno de los cinco niveles.
 *
 * Lo desconocido cae en INFO y no se rechaza: un evento con nivel raro sigue
 * siendo un evento válido, y tirar el lote entero por eso haría que el
 * appender reintentara para siempre.
 */
export function normalizeLevel(raw: unknown): LogLevel {
  if (typeof raw !== 'string') return 'INFO';
  const v = raw.trim().toUpperCase();
  if ((LOG_LEVELS as readonly string[]).includes(v)) return v as LogLevel;
  return ALIAS[v] ?? 'INFO';
}

/** ¿`level` es al menos tan grave como `min`? (la ingesta descarta lo de abajo) */
export function meetsMinLevel(level: LogLevel, min: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(min);
}

/** Solo ERROR y FATAL forman grupos de errores y notifican. */
export function isErrorLevel(level: LogLevel): boolean {
  return level === 'ERROR' || level === 'FATAL';
}
