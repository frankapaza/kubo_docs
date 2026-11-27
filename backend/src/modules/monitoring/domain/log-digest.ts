import { LOG_LEVELS, LogLevel } from './log-level';

/** Cuántos orígenes se listan en el resumen; el resto solo cuenta en el total. */
const MAX_FUENTES = 5;

export interface LogDigestSource {
  nombre: string;
  total: number;
  /** ERROR + FATAL. */
  errores: number;
  /** WARN. */
  avisos: number;
}

export interface LogDigestSummary {
  desde: string;
  hasta: string;
  total: number;
  porNivel: Record<LogLevel, number>;
  /** Los de más errores (luego avisos, luego volumen) primero; como mucho 5. */
  fuentes: LogDigestSource[];
  totalFuentes: number;
  /** Orígenes que enviaron en la ventana anterior y en esta no. */
  callados: string[];
}

/**
 * Resumen de lo que llegó a la ingesta en una ventana (30 min). Vive en
 * memoria: un reinicio pierde la ventana en curso, que es aceptable para un
 * aviso informativo (los logs en sí están en Loki).
 */
export class LogDigest {
  private since: Date;
  private sources = new Map<string, Tally>();
  /** Los orígenes de la ventana anterior, para detectar los que se callan. */
  private previous = new Set<string>();

  constructor(start: Date = new Date()) {
    this.since = start;
  }

  record(instalacion: string, aplicativo: string, servidor: string, niveles: LogLevel[]): void {
    if (niveles.length === 0) return;
    const nombre = `${instalacion} · ${aplicativo} (${servidor})`;
    const s = this.sources.get(nombre) ?? { nombre, total: 0, errores: 0, avisos: 0, porNivel: emptyLevels() };
    for (const n of niveles) {
      s.total++;
      s.porNivel[n]++;
      if (n === 'ERROR' || n === 'FATAL') s.errores++;
      else if (n === 'WARN') s.avisos++;
    }
    this.sources.set(nombre, s);
  }

  /** Cierra la ventana: devuelve su resumen (o `null` si no hay nada que contar) y empieza otra. */
  flush(now: Date = new Date()): LogDigestSummary | null {
    const all = [...this.sources.values()];
    const callados = [...this.previous].filter((n) => !this.sources.has(n)).sort((a, b) => a.localeCompare(b, 'es'));
    const desde = this.since;

    this.previous = new Set(this.sources.keys());
    this.sources = new Map();
    this.since = now;

    if (all.length === 0 && callados.length === 0) return null;

    const porNivel = emptyLevels();
    let total = 0;
    for (const s of all) {
      total += s.total;
      for (const l of LOG_LEVELS) porNivel[l] += s.porNivel[l];
    }
    const fuentes = all
      .sort((a, b) => b.errores - a.errores || b.avisos - a.avisos || b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'))
      .slice(0, MAX_FUENTES)
      .map(({ nombre, total: t, errores, avisos }) => ({ nombre, total: t, errores, avisos }));

    return { desde: desde.toISOString(), hasta: now.toISOString(), total, porNivel, fuentes, totalFuentes: all.length, callados };
  }
}

type Tally = LogDigestSource & { porNivel: Record<LogLevel, number> };

function emptyLevels(): Record<LogLevel, number> {
  return { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 };
}
