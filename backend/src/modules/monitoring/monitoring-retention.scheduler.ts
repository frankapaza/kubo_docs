import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

/** Días que se conservan ocurrencias y conteos diarios (spec: 180). */
const RETENTION_DAYS = 180;
/**
 * Filas por sentencia. Un DELETE de millones de filas en una base viva retiene
 * bloqueos y retrasa la réplica; en tandas, las escrituras de la ingesta se
 * intercalan entre una y otra.
 */
const BATCH = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Header {
  affectedRows: number;
}

/**
 * Purga diaria de lo que el monitoreo guarda en MySQL (los logs crudos los
 * expira Loki por su cuenta a los 30 días).
 *
 * - Ocurrencias y conteos diarios de más de 180 días.
 * - Grupos sin ticket y no vistos en 180 días, con lo suyo. Un grupo con
 *   `ticket_id` **nunca** se borra: el ticket remite a él.
 *
 * Sin repositorios ni entidades: son DELETE ... LIMIT que TypeORM no expresa.
 * El reloj entra por parámetro (`now`) para que ninguna prueba dependa de la
 * zona del proceso; la conexión va en UTC (`timezone: 'Z'`).
 */
@Injectable()
export class MonitoringRetentionScheduler {
  private readonly logger = new Logger(MonitoringRetentionScheduler.name);

  constructor(private readonly ds: DataSource) {}

  /** 03:30 UTC: de madrugada en Lima y lejos del ETL y de la retención de audio de las 3. */
  @Cron('0 30 3 * * *', { waitForCompletion: true })
  async run(): Promise<void> {
    try {
      const r = await this.purge(new Date());
      this.logger.log(`Retención de monitoreo: ${r.occurrences} ocurrencias, ${r.daily} días, ${r.groups} grupos`);
    } catch (err) {
      // Un fallo de hoy no debe tumbar nada: mañana se purga lo de hoy también.
      this.logger.error(`Retención de monitoreo fallida: ${(err as Error).message}`);
    }
  }

  async purge(now: Date): Promise<{ occurrences: number; daily: number; groups: number }> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
    // `day` es DATE (sin hora ni zona): se compara con el día UTC del corte.
    const cutoffDay = cutoff.toISOString().slice(0, 10);

    let occurrences = await this.deleteInBatches(
      'DELETE FROM error_occurrences WHERE occurred_at < ? LIMIT ?',
      cutoff,
    );
    let daily = await this.deleteInBatches('DELETE FROM error_group_daily WHERE day < ? LIMIT ?', cutoffDay);
    let groups = 0;

    // Los grupos, al final: ya sin lo que cuelga de ellos por antigüedad.
    for (;;) {
      const rows = (await this.ds.query(
        // `ticket_id IS NULL` va aquí y otra vez en el DELETE: si alguien
        // vincula un ticket entre las dos sentencias, el grupo se salva.
        'SELECT id FROM error_groups WHERE ticket_id IS NULL AND last_seen_at < ? LIMIT ?',
        [cutoff, BATCH],
      )) as Array<{ id: string }>;
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);
      const marks = ids.map(() => '?').join(',');

      // Las FK son RESTRICT sin cascada: primero lo que cuelga, luego el grupo.
      occurrences += this.affected(
        await this.ds.query(`DELETE FROM error_occurrences WHERE group_id IN (${marks})`, ids),
      );
      daily += this.affected(await this.ds.query(`DELETE FROM error_group_daily WHERE group_id IN (${marks})`, ids));
      const deleted = this.affected(
        await this.ds.query(`DELETE FROM error_groups WHERE id IN (${marks}) AND ticket_id IS NULL`, ids),
      );
      groups += deleted;
      // Si no se borró ninguno (todos recibieron ticket justo ahora) no hay
      // progreso posible: cortar en vez de girar para siempre.
      if (deleted === 0 || rows.length < BATCH) break;
    }

    return { occurrences, daily, groups };
  }

  private async deleteInBatches(sql: string, bound: Date | string): Promise<number> {
    let total = 0;
    for (;;) {
      const n = this.affected(await this.ds.query(sql, [bound, BATCH]));
      total += n;
      if (n < BATCH) return total;
    }
  }

  private affected(res: unknown): number {
    return (res as Header)?.affectedRows ?? 0;
  }
}
