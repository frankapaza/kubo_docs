import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { EngineStatus } from './engine';
import type { EngineEvent } from './events/diff-states';

export const LOCAL_API_HOST = '127.0.0.1';

/** Compara en tiempo constante (sobre sha256, para que la longitud tampoco se filtre). */
function secretMatches(given: string | string[] | undefined, secret: string): boolean {
  if (typeof given !== 'string' || given.length === 0) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export const EVENTS_DEFAULT_LIMIT = 200;
export const EVENTS_MAX_LIMIT = 500;

export interface LocalApiEngine {
  status(): EngineStatus;
  events(afterId: number, limit: number): { lastId: number; events: EngineEvent[] };
}

/** Entero ≥ `min` escrito solo con dígitos; `undefined` si no viene; `null` si es inválido. */
function intParam(raw: string | null, min: number): number | null | undefined {
  if (raw === null) return undefined;
  if (!/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min ? n : null;
}

/**
 * API local para el widget. Escucha SOLO en 127.0.0.1. Toda petición exige
 * `X-Kubo-Secret` (401 si falta o no coincide). `GET /v1/status` devuelve el
 * `EngineStatus`; `GET /v1/events?after=<id>&limit=<n>` (límite por defecto 200,
 * máximo 500) devuelve `{ lastId, events }` del diario; `after`/`limit` mal
 * formados → 400. Cualquier otra ruta, 404.
 */
export function startLocalApi(engine: LocalApiEngine, opts: { port: number; secret: string }): Server {
  if (!opts.secret) throw new Error('La API local necesita un secreto.');
  const server = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      const json = JSON.stringify(body);
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(json);
    };
    try {
      if (!secretMatches(req.headers['x-kubo-secret'], opts.secret)) return send(401, { code: 'UNAUTHORIZED' });
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/v1/status') return send(200, engine.status());
      if (req.method === 'GET' && path === '/v1/events') {
        const after = intParam(url.searchParams.get('after'), 0);
        const limit = intParam(url.searchParams.get('limit'), 1);
        if (after === null || limit === null) return send(400, { code: 'BAD_REQUEST' });
        return send(200, engine.events(after ?? 0, Math.min(limit ?? EVENTS_DEFAULT_LIMIT, EVENTS_MAX_LIMIT)));
      }
      return send(404, { code: 'NOT_FOUND' });
    } catch {
      return send(500, { code: 'INTERNAL' });
    }
  });
  server.listen(opts.port, LOCAL_API_HOST);
  return server;
}
