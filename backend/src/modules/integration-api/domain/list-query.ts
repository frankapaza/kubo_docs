import { BadRequestException } from '@nestjs/common';

/** Último par (`actualizadoEn`, `id`) entregado: la página siguiente empieza justo después. */
export interface Cursor {
  t: Date;
  i: number;
}

export interface ListQuery {
  estados?: string[];
  prioridades?: string[];
  sistemaId?: number;
  creadosDesde?: Date;
  creadosHasta?: Date;
  actualizadosDesde?: Date;
  limite: number;
  cursor?: Cursor;
}

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT_JSON = 500;
export const MAX_LIMIT_CSV = 5000;

/** Parámetros que admite una lista; `formato` lo lee el controlador. */
const ALLOWED = new Set(['estado', 'prioridad', 'sistemaId', 'creadosDesde', 'creadosHasta', 'actualizadosDesde', 'limite', 'cursor', 'formato']);
/** Fecha `YYYY-MM-DD` o fecha y hora ISO 8601 con zona (Z u offset). */
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;

const bad = (message: string) => new BadRequestException({ code: 'BAD_INPUT', message });

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ t: c.t.toISOString(), i: c.i }), 'utf8').toString('base64url');
}

export function decodeCursor(s: string): Cursor {
  let o: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('alfabeto');
    o = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  } catch {
    throw bad('cursor inválido');
  }
  const r = o as { t?: unknown; i?: unknown };
  const t = typeof r?.t === 'string' && ISO.test(r.t) ? new Date(r.t) : null;
  if (!t || Number.isNaN(t.getTime()) || !Number.isInteger(r.i) || (r.i as number) < 1) throw bad('cursor inválido');
  return { t, i: r.i as number };
}

function oneString(q: Record<string, unknown>, k: string): string | undefined {
  const v = q[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw bad(`«${k}» debe venir una sola vez`);
  return v.trim();
}

function date(q: Record<string, unknown>, k: string): Date | undefined {
  const v = oneString(q, k);
  if (v === undefined || v === '') return undefined;
  const d = ISO.test(v) ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw bad(`«${k}» debe ser una fecha ISO 8601 (p. ej. 2026-11-01 o 2026-11-01T00:00:00Z)`);
  return d;
}

function list(q: Record<string, unknown>, k: string, allowed: readonly string[]): string[] | undefined {
  const v = oneString(q, k);
  if (v === undefined || v === '') return undefined;
  const items = v.split(',').map((x) => x.trim()).filter(Boolean);
  const unknown = items.filter((x) => !allowed.includes(x));
  if (unknown.length) throw bad(`«${k}» no admite ${unknown.join(', ')}. Valores: ${allowed.join(', ')}`);
  return items;
}

/** Valida la query de una lista. Un parámetro desconocido o repetido es un 400, no se ignora. */
export function parseListQuery(
  q: Record<string, unknown>,
  opts: { estados: readonly string[]; prioridades: readonly string[]; csv: boolean },
): ListQuery {
  const unknownKeys = Object.keys(q).filter((k) => !ALLOWED.has(k));
  if (unknownKeys.length) throw bad(`Parámetros no admitidos: ${unknownKeys.join(', ')}`);

  const out: ListQuery = { limite: DEFAULT_LIMIT };
  const estados = list(q, 'estado', opts.estados);
  if (estados) out.estados = estados;
  const prioridades = list(q, 'prioridad', opts.prioridades);
  if (prioridades) out.prioridades = prioridades;

  const sistema = oneString(q, 'sistemaId');
  if (sistema !== undefined && sistema !== '') {
    if (!/^\d+$/.test(sistema) || Number(sistema) < 1) throw bad('«sistemaId» debe ser un entero positivo');
    out.sistemaId = Number(sistema);
  }

  for (const k of ['creadosDesde', 'creadosHasta', 'actualizadosDesde'] as const) {
    const d = date(q, k);
    if (d) out[k] = d;
  }

  const max = opts.csv ? MAX_LIMIT_CSV : MAX_LIMIT_JSON;
  const limite = oneString(q, 'limite');
  if (limite !== undefined && limite !== '') {
    const n = Number(limite);
    if (!/^\d+$/.test(limite) || n < 1 || n > max) throw bad(`«limite» debe estar entre 1 y ${max}`);
    out.limite = n;
  }

  const cursor = oneString(q, 'cursor');
  if (cursor) out.cursor = decodeCursor(cursor);
  return out;
}
