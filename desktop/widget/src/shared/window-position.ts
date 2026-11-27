import type { Corner } from './types';
import type { WidgetRow } from './widget-model';

export type { Corner };

export interface Rect { x: number; y: number; width: number; height: number }

export const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const WIDTH = 320;
export const BAR_HEIGHT = 40;
export const ROW_HEIGHT = 56;
export const MAX_VISIBLE_ROWS = 6;
export const SUMMARY_HEIGHT = 190;
export const HEALTH_HEIGHT = 170;
export const DEFAULT_MARGIN = 12;

export function isCorner(v: unknown): v is Corner {
  return typeof v === 'string' && (CORNERS as string[]).includes(v);
}

/** Esquina superior izquierda de la ventana para fijarla en `corner` del área de trabajo. */
export function positionFor(
  corner: Corner,
  workArea: Rect,
  size: { width: number; height: number },
  margin = DEFAULT_MARGIN,
): { x: number; y: number } {
  const left = workArea.x + margin;
  const right = workArea.x + workArea.width - size.width - margin;
  const top = workArea.y + margin;
  const bottom = workArea.y + workArea.height - size.height - margin;
  return {
    x: corner.endsWith('left') ? left : right,
    y: corner.startsWith('top') ? top : bottom,
  };
}

/** La esquina del cuadrante donde quedó el centro de la ventana al soltarla. */
export function nearestCorner(bounds: Rect, workArea: Rect): Corner {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const vertical = cy < workArea.y + workArea.height / 2 ? 'top' : 'bottom';
  const horizontal = cx < workArea.x + workArea.width / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}` as Corner;
}

export const MAX_UNFOLDED = 20;

/** Filas a la vista: las de primer nivel más los servicios de las filas de servidor desplegadas. */
export function visibleRows(rows: WidgetRow[], unfolded: readonly string[]): number {
  return rows.reduce((n, r) => n + 1 + (r.children.length > 0 && unfolded.includes(r.key) ? r.children.length : 0), 0);
}

/**
 * Valida lo que manda el renderer: un array (máx. 20) de claves de filas desplegables del modelo
 * actual. Devuelve las conocidas sin repetir, o null si la forma no es válida.
 */
export function sanitizeUnfolded(value: unknown, rows: WidgetRow[]): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_UNFOLDED) return null;
  const known = new Set(rows.filter((r) => r.children.length > 0).map((r) => r.key));
  const out: string[] = [];
  for (const k of value) if (typeof k === 'string' && known.has(k) && !out.includes(k)) out.push(k);
  return out;
}

export interface Layout {
  expanded: boolean;
  /** Filas a la vista (`visibleRows`). */
  rows: number;
  summary: boolean;
  health: boolean;
}

/** Plegada 40; desplegada 40 + 56 por fila (máx. 6, el resto con scroll); más los paneles abiertos. */
export function windowHeight(l: Layout): number {
  let h = BAR_HEIGHT;
  if (l.expanded) h += ROW_HEIGHT * Math.min(Math.max(l.rows, 0), MAX_VISIBLE_ROWS);
  if (l.summary) h += SUMMARY_HEIGHT;
  if (l.health) h += HEALTH_HEIGHT;
  return h;
}
