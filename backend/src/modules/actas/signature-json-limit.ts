import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response, json } from 'express';

/** Una firma en PNG en base64 puede pasar los 100 KB por defecto de Express (pantallas de alta densidad). */
export const SIGNATURE_JSON_LIMIT_BYTES = 1024 * 1024;

const RUTAS_DE_FIRMA = /\/(actas\/\d+\/signatures\/(in-person|email)|acta-sign\/[A-Za-z0-9_-]+\/confirm)\/?$/;

/** Solo estas rutas aceptan cuerpos de hasta 1 MB; el resto sigue con el límite general. */
export function registerSignatureJsonLimit(app: INestApplication): void {
  const analizador = json({ limit: SIGNATURE_JSON_LIMIT_BYTES });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && RUTAS_DE_FIRMA.test(req.path)) {
      analizador(req, res, next);
      return;
    }
    next();
  });
}

export const __test = { RUTAS_DE_FIRMA };
