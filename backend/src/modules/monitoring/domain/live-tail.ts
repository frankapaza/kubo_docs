import { LogFilter } from './log-filter';
import { LogLevel, meetsMinLevel } from './log-level';

/** Una línea tal como viaja por el socket a la pantalla de logs en vivo. */
export interface LiveLogLine {
  ts: string;
  nivel: LogLevel;
  instalacionId: number;
  clienteId: number | null;
  sistemaId: number | null;
  aplicativo: string;
  servidor: string;
  logger: string;
  mensaje: string;
  excepcion: string | null;
  hilo: string | null;
}

/** Tope por socket: un aplicativo en bucle no debe ahogar el navegador. */
export const LIVE_MAX_LINES_PER_SECOND = 200;

const WINDOW_MS = 1000;

/** ¿La línea cumple el filtro que el socket guardó al suscribirse? */
export function matchesLogFilter(f: LogFilter, l: LiveLogLine): boolean {
  if (f.instalacionId !== undefined && f.instalacionId !== l.instalacionId) return false;
  if (f.cliente !== undefined) {
    // 'interno' = instalación propia, que no tiene cliente.
    if (f.cliente === 'interno' ? l.clienteId !== null : f.cliente !== l.clienteId) return false;
  }
  if (f.sistemaId !== undefined && f.sistemaId !== l.sistemaId) return false;
  if (f.aplicativo !== undefined && f.aplicativo !== l.aplicativo) return false;
  if (f.servidor !== undefined && f.servidor !== l.servidor) return false;
  if (f.nivelMinimo !== undefined && !meetsMinLevel(l.nivel, f.nivelMinimo)) return false;
  if (f.texto !== undefined) {
    const t = f.texto.toLowerCase();
    const hay = [l.mensaje, l.excepcion, l.logger].some((s) => s != null && s.toLowerCase().includes(t));
    if (!hay) return false;
  }
  return true;
}

export interface LiveBudget {
  windowStart: number;
  sent: number;
}

/**
 * Ventana fija de un segundo por socket. Función pura (el reloj entra por
 * parámetro) para probarla sin temporizadores; el exceso lo cuenta quien llama
 * como `omitidas`.
 */
export function takeLiveBudget(
  b: LiveBudget | undefined,
  wanted: number,
  now: number,
): { budget: LiveBudget; allowed: number } {
  const cur = !b || now - b.windowStart >= WINDOW_MS ? { windowStart: now, sent: 0 } : b;
  const allowed = Math.max(0, Math.min(wanted, LIVE_MAX_LINES_PER_SECOND - cur.sent));
  return { budget: { windowStart: cur.windowStart, sent: cur.sent + allowed }, allowed };
}
