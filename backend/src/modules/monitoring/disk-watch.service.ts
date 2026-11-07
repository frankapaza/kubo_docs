import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { promises as fsp } from 'fs';

import { TicketsRealtimeGateway } from '../tickets/tickets-realtime.gateway';

export interface DiskStatus {
  path: string;
  /** `null` si no se pudo medir (en desarrollo no existe `/loki-data`). */
  usedPct: number | null;
  threshold: number;
  alert: boolean;
  checkedAt: string | null;
}

/**
 * Vigila el volumen de Loki (montado de solo lectura en el backend). Si se
 * llena, Loki deja de aceptar logs y el appender reintenta sin fin: mejor
 * avisar al personal antes.
 *
 * El aviso sale solo al **cruzar** el umbral hacia arriba, no en cada
 * comprobación (cada 10 min): si no, la campana sonaría sin parar. Al bajar se
 * rearma.
 */
@Injectable()
export class DiskWatchService {
  private readonly logger = new Logger(DiskWatchService.name);
  private readonly path: string;
  private readonly threshold: number;
  private current: DiskStatus;
  private alerted = false;

  constructor(private readonly gateway: TicketsRealtimeGateway) {
    this.path = process.env.LOKI_DATA_PATH || '/loki-data';
    const t = Number(process.env.LOKI_DISK_ALERT_PCT);
    this.threshold = Number.isFinite(t) && t > 0 ? t : 80;
    this.current = { path: this.path, usedPct: null, threshold: this.threshold, alert: false, checkedAt: null };
  }

  /** Separado para sustituirlo en pruebas: no dependen del disco de quien las corre. */
  protected readStatfs(path: string): Promise<{ blocks: number | bigint; bavail: number | bigint }> {
    return fsp.statfs(path);
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { waitForCompletion: true })
  async check(): Promise<DiskStatus> {
    const checkedAt = new Date().toISOString();
    let usedPct: number | null = null;
    try {
      const s = await this.readStatfs(this.path);
      const blocks = Number(s.blocks);
      // `bavail` (lo disponible para procesos sin privilegios), no `bfree`: es lo que Loki puede usar de verdad.
      if (blocks > 0) usedPct = Math.round(100 * (1 - Number(s.bavail) / blocks));
    } catch (err) {
      // Ruta inexistente en desarrollo: sin dato y sin ruido ni excepción.
      this.logger.debug(`No se pudo medir ${this.path}: ${(err as Error).message}`);
    }

    const alert = usedPct !== null && usedPct >= this.threshold;
    if (alert && !this.alerted) {
      try {
        this.gateway.notifyDiskAlert({ usedPct: usedPct as number, threshold: this.threshold });
      } catch (err) {
        this.logger.warn(`No se pudo emitir el aviso de disco: ${(err as Error).message}`);
      }
    }
    // Sin dato (null) no se rearma: un fallo de lectura no es "el disco bajó".
    if (usedPct !== null) this.alerted = alert;

    this.current = { path: this.path, usedPct, threshold: this.threshold, alert, checkedAt };
    return this.current;
  }

  status(): DiskStatus {
    return this.current;
  }
}
