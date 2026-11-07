import { BadRequestException, Injectable } from '@nestjs/common';

import { LogFilter } from './domain/log-filter';
import { LogLevel, normalizeLevel } from './domain/log-level';
import { LogSearchQueryDto } from './dto/log-search.dto';
import { LokiClient, LokiEntry } from './loki/loki.client';
import { buildLogQuery } from './loki/logql';

export interface LogLineView {
  id: string;
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
  propiedades: Record<string, string>;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Loki rechaza consultas de más de 30d1h (max_query_length 721h): exigir
// 30 días como máximo deja la consulta dentro con una hora de holgura.
const MAX_RANGE_MS = 30 * DAY_MS;
const PERU_OFFSET = '-05:00';

const isDayOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function badRange(message: string): BadRequestException {
  return new BadRequestException({ code: 'LOG_RANGE_INVALID', message });
}

/** Instante de un parámetro; un día suelto es día de Perú (igual que en errores). */
function parseInstant(raw: string, field: string): Date {
  const d = new Date(isDayOnly(raw) ? `${raw}T00:00:00.000${PERU_OFFSET}` : raw);
  if (Number.isNaN(d.getTime())) throw badRange(`${field} no es una fecha válida`);
  return d;
}

const nsToIso = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

@Injectable()
export class LogsService {
  constructor(private readonly loki: LokiClient) {}

  async search(q: LogSearchQueryDto, now: Date = new Date()): Promise<{ lines: LogLineView[]; nextCursor: string | null }> {
    // Sin rango: la última hora (lo que se mira al abrir la pantalla).
    let hasta = q.hasta ? parseInstant(q.hasta, 'hasta') : now;
    // `hasta` con día suelto incluye ese día entero.
    if (q.hasta && isDayOnly(q.hasta)) hasta = new Date(hasta.getTime() + DAY_MS);
    const desde = q.desde ? parseInstant(q.desde, 'desde') : new Date(hasta.getTime() - HOUR_MS);

    if (desde.getTime() > hasta.getTime()) throw badRange('desde no puede ser posterior a hasta');
    if (hasta.getTime() - desde.getTime() > MAX_RANGE_MS) throw badRange('el rango no puede superar 30 días');

    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // El cursor (ns) solo puede acercar el fin, nunca alejarlo del rango pedido.
    // BigInt: un ns actual (~1.7e18) excede los enteros exactos de Number.
    let endNs = BigInt(hasta.getTime()) * 1_000_000n;
    if (q.cursor !== undefined) {
      const c = BigInt(q.cursor);
      if (c < endNs) endNs = c;
    }
    if (endNs < BigInt(desde.getTime()) * 1_000_000n) return { lines: [], nextCursor: null };

    const filter: LogFilter = {};
    if (q.instalacionId !== undefined) filter.instalacionId = q.instalacionId;
    if (q.cliente !== undefined) filter.cliente = q.cliente === 'interno' ? 'interno' : Number(q.cliente);
    if (q.sistemaId !== undefined) filter.sistemaId = q.sistemaId;
    if (q.aplicativo) filter.aplicativo = q.aplicativo;
    if (q.servidor) filter.servidor = q.servidor;
    if (q.nivel) filter.nivelMinimo = q.nivel;
    if (q.q) filter.texto = q.q;

    const entries = await this.loki.queryRange({
      query: buildLogQuery(filter),
      start: desde,
      end: hasta,
      endNs: String(endNs),
      limit,
      direction: 'backward',
    });

    const lines = entries.map((e, i) => this.toView(e, i));
    // Menos líneas que el límite: no hay más. Si no, el siguiente `end` es el
    // ns de la última menos 1 (el fin de Loki es exclusivo, así no se repite).
    const nextCursor = entries.length >= limit ? String(BigInt(entries[entries.length - 1].tsNs) - 1n) : null;
    return { lines, nextCursor };
  }

  private toView(e: LokiEntry, i: number): LogLineView {
    // Una línea que no es JSON (o no es un objeto) se muestra tal cual.
    let obj: Record<string, unknown> | null = null;
    try {
      const p: unknown = JSON.parse(e.line);
      if (typeof p === 'object' && p !== null && !Array.isArray(p)) obj = p as Record<string, unknown>;
    } catch {
      /* línea de texto plano */
    }

    const props: Record<string, string> = {};
    const rawProps = obj?.propiedades;
    if (typeof rawProps === 'object' && rawProps !== null) {
      for (const [k, v] of Object.entries(rawProps)) props[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }

    const l = e.labels;
    return {
      id: `${e.tsNs}-${i}`,
      ts: nsToIso(e.tsNs),
      nivel: normalizeLevel(l.nivel),
      instalacionId: Number(l.instalacion),
      clienteId: l.cliente && l.cliente !== 'interno' ? Number(l.cliente) : null,
      sistemaId: l.sistema && l.sistema !== 'ninguno' ? Number(l.sistema) : null,
      aplicativo: l.aplicativo ?? '',
      servidor: l.servidor ?? '',
      logger: obj ? (str(obj.logger) ?? '') : '',
      mensaje: obj ? (str(obj.mensaje) ?? '') : e.line,
      excepcion: obj ? str(obj.excepcion) : null,
      hilo: obj ? str(obj.hilo) : null,
      propiedades: props,
    };
  }
}
