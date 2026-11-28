import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response, json } from 'express';

/** Un documento entero (hasta 200 000 caracteres) pasa los 100 KB por defecto de Express. */
export const DOCUMENT_JSON_LIMIT_BYTES = 1024 * 1024;

const RUTAS_DEL_DOCUMENTO = /\/projects\/\d+\/expediente\/deliverables\/\d+\/document(\/ai-adjust)?\/?$/;

/** Solo guardar el documento y pedir el ajuste con IA aceptan cuerpos de hasta 1 MB. */
export function registerDocumentJsonLimit(app: INestApplication): void {
  const analizador = json({ limit: DOCUMENT_JSON_LIMIT_BYTES });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method === 'PUT' || req.method === 'POST') && RUTAS_DEL_DOCUMENTO.test(req.path)) {
      analizador(req, res, next);
      return;
    }
    next();
  });
}

export const __test = { RUTAS_DEL_DOCUMENTO };
