import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AcceptBatchResult, AvailabilityIngestService, SyncResponse } from './availability-ingest.service';
import { AvailabilitySyncService } from './availability-sync.service';
import { ProbeBatchDto } from './dto/ingest.dto';
import { ProbeRateLimiter } from './probe-rate-limiter';
import { ProbeRequest, ProbeTokenGuard } from './probe-token.guard';

/**
 * Lo que llama la sonda de la oficina. Solo `ProbeTokenGuard`: NO lleva
 * `JwtAuthGuard` (llama una máquina). El tope de 1 MB del cuerpo lo pone
 * `registerProbeIngestJsonLimit`; el de 500 checks / 200 señales, el DTO.
 */
@Controller('ingest/probe')
@UseGuards(ProbeTokenGuard)
export class AvailabilityIngestController {
  constructor(
    private readonly ingest: AvailabilityIngestService,
    private readonly syncService: AvailabilitySyncService,
    private readonly limiter: ProbeRateLimiter,
  ) {}

  @Post('batch')
  @HttpCode(200)
  async batch(
    @Req() req: ProbeRequest,
    @Body() dto: ProbeBatchDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptBatchResult> {
    const probe = req.probe!;
    const taken = this.limiter.take(Number(probe.id), Date.now());
    if (!taken.ok) {
      res.setHeader('Retry-After', String(taken.retryAfterSec));
      throw new HttpException(
        { code: 'TOO_MANY_REQUESTS', message: 'Demasiados lotes por minuto para esta sonda.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.ingest.acceptBatch(probe, dto, new Date());
  }

  @Get('sync')
  sync(@Req() req: ProbeRequest, @Query('configVersion') configVersion?: string): Promise<SyncResponse> {
    return this.syncService.sync(req.probe!, configVersion || null);
  }
}
