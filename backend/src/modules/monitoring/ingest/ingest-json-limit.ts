import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response, json } from 'express';

import { MAX_BATCH_BYTES } from '../domain/ingest-batch';

/**
 * El analizador de JSON de `POST /ingest/logs`, con el tope del contrato
 * (2 MB) y no con los 100 KB de express.
 *
 * Mismo patrón que `registerBulkSendJsonLimit` (ver allí el porqué completo):
 * se registra con `app.use` ANTES de `init()` —después, el analizador de Nest
 * ya habría leído y rechazado el cuerpo— y lo llaman las dos puntas que
 * levantan la aplicación, `main.ts` y `startTestHttpApp`. Se mira el final
 * del camino para no depender del prefijo global.
 *
 * **El tope es del cuerpo DESCOMPRIMIDO.** El appender manda gzip; con
 * `inflate: true` body-parser descomprime en flujo y `raw-body` cuenta los
 * bytes YA inflados contra `limit` (solo toma `Content-Length` como dato
 * previo cuando no hay codificación). Así una bomba gzip de pocos KB que se
 * expande a cientos de MB se corta al pasar de 2 MB, con el error
 * `entity.too.large` que `HttpExceptionFilter` traduce a 413 `{ code, message }`
 * (y el appender, ante 413, tira el lote en vez de reintentarlo).
 */
const RUTA_DE_INGESTA = /\/ingest\/logs\/?$/;

export function registerIngestJsonLimit(app: INestApplication): void {
  const analizador = json({ limit: MAX_BATCH_BYTES, inflate: true });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && RUTA_DE_INGESTA.test(req.path)) {
      analizador(req, res, next);
      return;
    }
    next();
  });
}
