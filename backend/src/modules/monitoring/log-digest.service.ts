import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TicketsRealtimeGateway } from '../tickets/tickets-realtime.gateway';
import { LogDigest, LogDigestSummary } from './domain/log-digest';
import { LogLevel } from './domain/log-level';

/**
 * Cada 30 minutos (en punto y a la media) manda al panel un resumen de los
 * logs recibidos: cuántos por nivel, los orígenes con más errores y los que
 * dejaron de enviar. El panel lo muestra como notificación del sistema.
 */
@Injectable()
export class LogDigestService {
  private readonly logger = new Logger(LogDigestService.name);
  private readonly digest = new LogDigest();

  constructor(private readonly gateway: TicketsRealtimeGateway) {}

  record(instalacion: string, aplicativo: string, servidor: string, niveles: LogLevel[]): void {
    this.digest.record(instalacion, aplicativo, servidor, niveles);
  }

  @Cron('0 0,30 * * * *')
  flush(now: Date = new Date()): LogDigestSummary | null {
    const summary = this.digest.flush(now);
    if (summary) {
      try {
        this.gateway.notifyLogDigest(summary);
      } catch (e) {
        this.logger.warn(`No se pudo publicar el resumen de logs: ${(e as Error)?.message ?? e}`);
      }
    }
    return summary;
  }
}
