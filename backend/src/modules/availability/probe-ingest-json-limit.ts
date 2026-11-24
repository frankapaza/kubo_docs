import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response, json } from 'express';
import { bearerToken, INVALID_PROBE_TOKEN_BODY } from './probe-token.guard';

/** Tope del cuerpo de `POST /ingest/probe/batch`: 1 MB (no sube el límite global). */
export const PROBE_BATCH_MAX_BYTES = '1mb';

const RUTA = /\/ingest\/probe\/batch\/?$/;

/**
 * Mismo patrón que `registerIngestJsonLimit` (ver allí el porqué): se
 * registra con `app.use` ANTES de `init()`, lo llaman `main.ts` y
 * `startTestHttpApp`, y mira el final del camino para no depender del prefijo.
 * Sin `Authorization: Bearer kmp_…` con forma válida no se lee el cuerpo
 * (401 con el mismo cuerpo que la guarda); la búsqueda del token la sigue
 * haciendo `ProbeTokenGuard`.
 */
export function registerProbeIngestJsonLimit(app: INestApplication): void {
  const analizador = json({ limit: PROBE_BATCH_MAX_BYTES });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && RUTA.test(req.path)) {
      if (!bearerToken(req.headers.authorization)?.startsWith('kmp_')) {
        res.status(401).json({
          statusCode: 401,
          ...INVALID_PROBE_TOKEN_BODY,
          path: req.url,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      analizador(req, res, next);
      return;
    }
    next();
  });
}
