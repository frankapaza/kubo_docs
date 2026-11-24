import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response, json } from 'express';

/** GitHub firma los bytes exactos: el HMAC no se puede rehacer sobre un JSON ya parseado. */
export type RawBodyRequest = Request & { rawBody?: Buffer };

const RUTA_DEL_WEBHOOK = /\/dev\/github\/webhook\/?$/;

/** Los eventos de push grandes rondan cientos de KB; 1 MB deja margen (spec §4.2). */
export const WEBHOOK_MAX_BYTES = '1mb';

/**
 * Analizador propio solo para `POST …/dev/github/webhook`, montado antes que
 * el de Nest (mismo recurso que `registerIngestJsonLimit`): guarda el cuerpo
 * crudo en `req.rawBody` para verificar `X-Hub-Signature-256`. El analizador
 * global ve el cuerpo ya leído y no lo toca. El resto de rutas no cambia.
 */
export function registerGithubWebhookBody(app: INestApplication): void {
  const analizador = json({
    limit: WEBHOOK_MAX_BYTES,
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = Buffer.from(buf);
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && RUTA_DEL_WEBHOOK.test(req.path)) {
      analizador(req, res, next);
      return;
    }
    next();
  });
}
