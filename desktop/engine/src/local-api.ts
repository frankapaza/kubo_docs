import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { EngineStatus } from './engine';

export const LOCAL_API_HOST = '127.0.0.1';

/** Compara en tiempo constante (sobre sha256, para que la longitud tampoco se filtre). */
function secretMatches(given: string | string[] | undefined, secret: string): boolean {
  if (typeof given !== 'string' || given.length === 0) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * API local para el widget. Escucha SOLO en 127.0.0.1. Toda petición exige
 * `X-Kubo-Secret` (401 si falta o no coincide); `GET /v1/status` devuelve el
 * `EngineStatus` y cualquier otra ruta, 404.
 */
export function startLocalApi(engine: { status(): EngineStatus }, opts: { port: number; secret: string }): Server {
  if (!opts.secret) throw new Error('La API local necesita un secreto.');
  const server = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      const json = JSON.stringify(body);
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(json);
    };
    try {
      if (!secretMatches(req.headers['x-kubo-secret'], opts.secret)) return send(401, { code: 'UNAUTHORIZED' });
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/v1/status') return send(200, engine.status());
      return send(404, { code: 'NOT_FOUND' });
    } catch {
      return send(500, { code: 'INTERNAL' });
    }
  });
  server.listen(opts.port, LOCAL_API_HOST);
  return server;
}
