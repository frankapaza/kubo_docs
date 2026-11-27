import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response, json } from 'express';
import { AGENT_TOKEN_PREFIX, INVALID_AGENT_TOKEN_BODY } from './agent-token.guard';
import { bearerToken, INVALID_PROBE_TOKEN_BODY } from './probe-token.guard';

/** Tope del cuerpo de `POST /ingest/probe/batch`: 1 MB (no sube el límite global). */
export const PROBE_BATCH_MAX_BYTES = '1mb';
/** Tope del cuerpo de `POST /ingest/probe/agent/samples`: 64 KB. */
export const AGENT_SAMPLE_MAX_BYTES = '64kb';

const RUTA = /\/ingest\/probe\/batch\/?$/;
const RUTA_AGENTE = /\/ingest\/probe\/agent\/samples\/?$/;

interface Corte {
  ruta: RegExp;
  prefijo: string;
  cuerpo: { code: string; message: string };
  analizador: ReturnType<typeof json>;
}

/**
 * Mismo patrón que `registerIngestJsonLimit` (ver allí el porqué): se
 * registra con `app.use` ANTES de `init()`, lo llaman `main.ts` y
 * `startTestHttpApp`, y mira el final del camino para no depender del prefijo.
 * Sin `Authorization: Bearer kmp_…` (sonda) o `kma_…` (agente) con forma
 * válida no se lee el cuerpo (401 con el mismo cuerpo que la guarda); la
 * búsqueda del token la siguen haciendo `ProbeTokenGuard` y `AgentTokenGuard`.
 */
export function registerProbeIngestJsonLimit(app: INestApplication): void {
  const cortes: Corte[] = [
    { ruta: RUTA, prefijo: 'kmp_', cuerpo: INVALID_PROBE_TOKEN_BODY, analizador: json({ limit: PROBE_BATCH_MAX_BYTES }) },
    {
      ruta: RUTA_AGENTE,
      prefijo: AGENT_TOKEN_PREFIX,
      cuerpo: INVALID_AGENT_TOKEN_BODY,
      analizador: json({ limit: AGENT_SAMPLE_MAX_BYTES }),
    },
  ];

  app.use((req: Request, res: Response, next: NextFunction) => {
    const corte = req.method === 'POST' ? cortes.find((c) => c.ruta.test(req.path)) : undefined;
    if (!corte) {
      next();
      return;
    }
    if (!bearerToken(req.headers.authorization)?.startsWith(corte.prefijo)) {
      res.status(401).json({
        statusCode: 401,
        ...corte.cuerpo,
        path: req.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    corte.analizador(req, res, next);
  });
}
