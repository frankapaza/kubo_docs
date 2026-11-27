import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response, json } from 'express';
import { IMPORT_CSV_MAX_BYTES } from './dto/import.dto';

/**
 * Tope de JSON de `POST /availability/import/{preview,commit}`: 256 KB, y no los
 * 100 KB globales (que rechazarían un CSV legítimo antes que el DTO). Mismo patrón
 * y mismo porqué que `registerProbeIngestJsonLimit`: se registra con `app.use`
 * ANTES de `init()` (lo llaman `main.ts` y `startTestHttpApp`); un cuerpo mayor
 * sale como 413 por el filtro global.
 */
const RUTA = /\/availability\/import\/(preview|commit)\/?$/;

export function registerImportJsonLimit(app: INestApplication): void {
  const analizador = json({ limit: IMPORT_CSV_MAX_BYTES });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && RUTA.test(req.path)) {
      analizador(req, res, next);
      return;
    }
    next();
  });
}
