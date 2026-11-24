import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository } from 'typeorm';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorProbeSignal } from './entities/monitor-probe-signal.entity';

export const PURGE_RETENTION_DAYS = 90;
export const PURGE_BATCH_SIZE = 5000;

/** Purga diaria (03:00 Lima) de checks y señales procesadas con más de 90 días. Solo la registra el worker. */
@Injectable()
export class AvailabilityPurgeService {
  private readonly logger = new Logger(AvailabilityPurgeService.name);

  constructor(
    @InjectRepository(MonitorCheck) private readonly checks: Repository<MonitorCheck>,
    @InjectRepository(MonitorProbeSignal) private readonly signals: Repository<MonitorProbeSignal>,
  ) {}

  @Cron('0 0 3 * * *', { timeZone: 'America/Lima' })
  async run(): Promise<void> {
    try {
      const r = await this.purge(new Date());
      this.logger.log(`Purga de disponibilidad: ${r.checks} checks y ${r.signals} señales borrados`);
    } catch (e) {
      this.logger.error(`Purga de disponibilidad fallida: ${(e as Error).message}`);
    }
  }

  async purge(now: Date): Promise<{ checks: number; signals: number }> {
    const cutoff = new Date(now.getTime() - PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const checks = await this.deleteInBatches(this.checks, 'started_at < ?', cutoff);
    const signals = await this.deleteInBatches(
      this.signals,
      'processed_at IS NOT NULL AND received_at < ?',
      cutoff,
    );
    return { checks, signals };
  }

  /** `DELETE ... LIMIT 5000` repetido hasta que un lote sale incompleto (o vacío). */
  private async deleteInBatches<T extends ObjectLiteral>(repo: Repository<T>, where: string, cutoff: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const res = (await repo.query(`DELETE FROM \`${repo.metadata.tableName}\` WHERE ${where} LIMIT ${PURGE_BATCH_SIZE}`, [cutoff])) as { affectedRows?: number };
      const n = res.affectedRows ?? 0;
      total += n;
      if (n < PURGE_BATCH_SIZE) return total;
    }
  }
}
