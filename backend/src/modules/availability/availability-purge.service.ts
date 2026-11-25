import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository } from 'typeorm';
import { IStorageService, STORAGE_SERVICE } from '../audio/interfaces/storage.interface';
import { limaDateOf } from './domain/expected-slots';
import { MonitorAgentDailyRollup } from './entities/monitor-agent-daily-rollup.entity';
import { MonitorAgentSample } from './entities/monitor-agent-sample.entity';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorDailyRollup } from './entities/monitor-daily-rollup.entity';
import { MonitorEvidence } from './entities/monitor-evidence.entity';
import { MonitorIncidentEvent } from './entities/monitor-incident-event.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorMonthlyReport } from './entities/monitor-monthly-report.entity';
import { MonitorProbeGap } from './entities/monitor-probe-gap.entity';
import { MonitorProbeSignal } from './entities/monitor-probe-signal.entity';
import { MonitorRollupDay } from './entities/monitor-rollup-day.entity';

export const PURGE_RETENTION_DAYS = 90;
/** Muestras crudas del agente: 30 días (el informe usa sus resúmenes diarios). */
export const AGENT_SAMPLE_RETENTION_DAYS = 30;
/** Resúmenes, huecos, informes e incidentes recuperados se guardan 12 meses. */
export const REPORT_RETENTION_DAYS = 365;
export const PURGE_BATCH_SIZE = 5000;
export const INCIDENT_PURGE_BATCH = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeResult {
  checks: number;
  signals: number;
  rollups: number;
  rollupDays: number;
  gaps: number;
  reports: number;
  incidents: number;
  agentSamples: number;
  agentRollups: number;
}

/**
 * Purga diaria (03:00 Lima). Corre en el backend.
 * - 30 días: muestras del agente.
 * - 90 días: checks y señales procesadas.
 * - 12 meses: resúmenes diarios (de sonda y de agente), días resumidos, huecos de sonda, informes
 *   mensuales e incidentes recuperados (con su evidencia y eventos). Los
 *   tickets nunca se tocan.
 */
@Injectable()
export class AvailabilityPurgeService {
  private readonly logger = new Logger(AvailabilityPurgeService.name);

  constructor(
    @InjectRepository(MonitorCheck) private readonly checks: Repository<MonitorCheck>,
    @InjectRepository(MonitorProbeSignal) private readonly signals: Repository<MonitorProbeSignal>,
    @InjectRepository(MonitorDailyRollup) private readonly rollups: Repository<MonitorDailyRollup>,
    @InjectRepository(MonitorRollupDay) private readonly rollupDays: Repository<MonitorRollupDay>,
    @InjectRepository(MonitorProbeGap) private readonly gaps: Repository<MonitorProbeGap>,
    @InjectRepository(MonitorMonthlyReport) private readonly reports: Repository<MonitorMonthlyReport>,
    @InjectRepository(MonitorIncident) private readonly incidents: Repository<MonitorIncident>,
    @InjectRepository(MonitorIncidentEvent) private readonly events: Repository<MonitorIncidentEvent>,
    @InjectRepository(MonitorEvidence) private readonly evidence: Repository<MonitorEvidence>,
    @InjectRepository(MonitorAgentSample) private readonly agentSamples: Repository<MonitorAgentSample>,
    @InjectRepository(MonitorAgentDailyRollup) private readonly agentRollups: Repository<MonitorAgentDailyRollup>,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  @Cron('0 0 3 * * *', { timeZone: 'America/Lima' })
  async run(): Promise<void> {
    try {
      const r = await this.purge(new Date());
      this.logger.log(
        `Purga de disponibilidad: ${r.checks} checks, ${r.signals} señales, ${r.rollups} resúmenes, ` +
          `${r.rollupDays} días resumidos, ${r.gaps} huecos, ${r.reports} informes, ${r.incidents} incidentes, ` +
          `${r.agentSamples} muestras y ${r.agentRollups} resúmenes del agente borrados`,
      );
    } catch (e) {
      this.logger.error(`Purga de disponibilidad fallida: ${(e as Error).message}`);
    }
  }

  async purge(now: Date): Promise<PurgeResult> {
    const cutoff = new Date(now.getTime() - PURGE_RETENTION_DAYS * DAY_MS);
    const checks = await this.deleteInBatches(this.checks, 'started_at < ?', cutoff);
    const signals = await this.deleteInBatches(
      this.signals,
      'processed_at IS NOT NULL AND processed_at < ?',
      cutoff,
    );

    const yearCutoff = new Date(now.getTime() - REPORT_RETENTION_DAYS * DAY_MS);
    const cutoffDate = limaDateOf(yearCutoff);
    const rollups = await this.deleteInBatches(this.rollups, 'date < ?', cutoffDate);
    const rollupDays = await this.deleteInBatches(this.rollupDays, 'date < ?', cutoffDate);
    const gaps = await this.deleteInBatches(this.gaps, 'date < ?', cutoffDate);
    const reports = await this.deleteInBatches(this.reports, 'month < ?', cutoffDate.slice(0, 7));
    const incidents = await this.purgeIncidents(yearCutoff);

    const agentCutoff = new Date(now.getTime() - AGENT_SAMPLE_RETENTION_DAYS * DAY_MS);
    const agentSamples = await this.deleteInBatches(this.agentSamples, 'at < ?', agentCutoff);
    const agentRollups = await this.deleteInBatches(this.agentRollups, 'date < ?', cutoffDate);
    return { checks, signals, rollups, rollupDays, gaps, reports, incidents, agentSamples, agentRollups };
  }

  /** `DELETE ... LIMIT 5000` repetido hasta que un lote sale incompleto (o vacío). */
  private async deleteInBatches<T extends ObjectLiteral>(
    repo: Repository<T>,
    where: string,
    cutoff: Date | string,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const res = (await repo.query(
        `DELETE FROM \`${repo.metadata.tableName}\` WHERE ${where} LIMIT ${PURGE_BATCH_SIZE}`,
        [cutoff],
      )) as { affectedRows?: number };
      const n = res.affectedRows ?? 0;
      total += n;
      if (n < PURGE_BATCH_SIZE) return total;
    }
  }

  /**
   * Incidentes recuperados antes de `cutoff`, por lotes: primero los hijos y
   * luego los padres que ya no tienen hijos (la FK parent_id no tiene cascada).
   * Un padre con algún hijo reciente se queda hasta que el hijo caduque.
   */
  private async purgeIncidents(cutoff: Date): Promise<number> {
    const seen = new Set<number>();
    for (;;) {
      const rows = (await this.incidents.query(
        'SELECT i.id FROM monitor_incidents i ' +
          'WHERE i.recovered_at IS NOT NULL AND i.recovered_at < ? ' +
          'AND NOT EXISTS (SELECT 1 FROM monitor_incidents c WHERE c.parent_id = i.id) ' +
          `ORDER BY i.parent_id IS NULL, i.id LIMIT ${INCIDENT_PURGE_BATCH}`,
        [cutoff],
      )) as Array<{ id: number | string }>;
      const ids = rows.map((r) => Number(r.id)).filter((id) => !seen.has(id));
      // Sin filas nuevas: terminado (o la base no borró lo anterior; no se insiste).
      if (ids.length === 0) return seen.size;
      await this.deleteIncidents(ids);
      ids.forEach((id) => seen.add(id));
    }
  }

  /** Borra en orden: archivos y filas de evidencia, eventos, incidentes hijos y padres. */
  private async deleteIncidents(ids: number[]): Promise<void> {
    const ph = ids.map(() => '?').join(',');
    const files = (await this.evidence.query(
      `SELECT storage_key AS storageKey FROM monitor_evidence WHERE incident_id IN (${ph})`,
      ids,
    )) as Array<{ storageKey: string }>;
    for (const f of files) {
      await this.storage
        .remove(f.storageKey)
        .catch((e) => this.logger.warn(`No se pudo borrar el archivo ${f.storageKey}: ${(e as Error)?.message ?? e}`));
    }
    await this.evidence.query(`DELETE FROM monitor_evidence WHERE incident_id IN (${ph})`, ids);
    await this.events.query(`DELETE FROM monitor_incident_events WHERE incident_id IN (${ph})`, ids);
    await this.incidents.query(`DELETE FROM monitor_incidents WHERE id IN (${ph}) AND parent_id IS NOT NULL`, ids);
    await this.incidents.query(`DELETE FROM monitor_incidents WHERE id IN (${ph})`, ids);
  }
}
