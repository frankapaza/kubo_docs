import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';

import { IngestRateLimitedException, IngestService } from './ingest.service';
import { IngestRequest, InstallationKeyGuard } from './installation-key.guard';

/**
 * `POST /api/v1/ingest/logs`: lo que llama el appender `Kubo.Log4Net`.
 *
 * Códigos y lo que el appender hace con cada uno (contrato compartido):
 * 202 → listo; 503/429 → reintenta el mismo lote con espera (429 respeta
 * `Retry-After`); 401 → reintenta en minutos (la clave puede regenerarse);
 * 400/413 → descarta el lote.
 */
@Controller('ingest')
@UseGuards(InstallationKeyGuard)
export class IngestController {
  constructor(private readonly service: IngestService) {}

  /**
   * Sin DTO a propósito: `@Body() body: unknown` hace que el pipe global no
   * valide nada. Con un DTO, `forbidNonWhitelisted` rechazaría con 400 a un
   * appender más nuevo que mande un campo que este backend aún no conoce, y
   * un 400 hace que el appender TIRE el lote. La validación (tolerante) la
   * hace `parseIngestBatch`.
   */
  @Post('logs')
  @HttpCode(202)
  async ingest(
    @Req() req: IngestRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ aceptados: number; descartadosPorNivel: number }> {
    try {
      // La guarda garantiza `installation`; sin ella no se llega aquí.
      return await this.service.ingest(req.installation!, body);
    } catch (e) {
      // La cabecera se pone aquí y la excepción sigue al filtro global, que
      // escribe el cuerpo `{ code, message }` sin tocar las cabeceras ya puestas.
      if (e instanceof IngestRateLimitedException) res.setHeader('Retry-After', String(e.retryAfterSec));
      throw e;
    }
  }
}
