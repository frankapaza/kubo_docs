import { LOG_LEVELS, LogLevel } from './log-level';

export interface LogFilter {
  instalacionId?: number;
  cliente?: number | 'interno';
  sistemaId?: number;
  aplicativo?: string;
  servidor?: string;
  nivelMinimo?: LogLevel;
  texto?: string;
}

const MAX_TEXTO = 200;
const MAX_ETIQUETA = 100;

/** Entero positivo, venga como número o como cadena de query string. */
function positiveInt(v: unknown): number | undefined {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t.slice(0, max);
}

/**
 * Filtro de logs a partir de lo que llega por query o por socket.
 *
 * Descarta en silencio lo inválido en lugar de fallar: la pantalla manda el
 * filtro tal cual lo teclea la persona y un valor a medias no debe romperla.
 * Lo que sobrevive acaba en un selector de Loki, de ahí los topes.
 */
export function parseLogFilter(raw: unknown): LogFilter {
  const f: LogFilter = {};
  if (typeof raw !== 'object' || raw === null) return f;
  const r = raw as Record<string, unknown>;

  const instalacionId = positiveInt(r.instalacionId);
  if (instalacionId !== undefined) f.instalacionId = instalacionId;

  if (r.cliente === 'interno') f.cliente = 'interno';
  else {
    const cliente = positiveInt(r.cliente);
    if (cliente !== undefined) f.cliente = cliente;
  }

  const sistemaId = positiveInt(r.sistemaId);
  if (sistemaId !== undefined) f.sistemaId = sistemaId;

  const aplicativo = text(r.aplicativo, MAX_ETIQUETA);
  if (aplicativo) f.aplicativo = aplicativo;
  const servidor = text(r.servidor, MAX_ETIQUETA);
  if (servidor) f.servidor = servidor;

  // Aquí NO se usa normalizeLevel: un nivel desconocido se descarta, no pasa a INFO.
  if (typeof r.nivelMinimo === 'string') {
    const n = r.nivelMinimo.trim().toUpperCase();
    if ((LOG_LEVELS as readonly string[]).includes(n)) f.nivelMinimo = n as LogLevel;
  }

  const texto = text(r.texto, MAX_TEXTO);
  if (texto) f.texto = texto;
  return f;
}
