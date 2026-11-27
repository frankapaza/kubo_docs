import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AgentDisk } from './monitor-agent-sample.entity';
import { decimalANumero } from './numeric.transformer';

/** Resumen diario del agente de un servidor. `date` es 'YYYY-MM-DD'. */
@Entity('monitor_agent_daily_rollups')
@Index('uq_monitor_agent_daily_rollup', ['serverId', 'date'], { unique: true })
export class MonitorAgentDailyRollup {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'server_id', type: 'bigint', unsigned: true })
  serverId!: number;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'int', default: 0 })
  samples!: number;

  @Column({ name: 'cpu_hist', type: 'json' })
  cpuHist!: number[];

  @Column({ name: 'ram_hist', type: 'json' })
  ramHist!: number[];

  @Column({ name: 'disks_close', type: 'json' })
  disksClose!: AgentDisk[];

  /** Media y máximo del día (migración 038). NULL en días resumidos antes de la 038. */
  @Column({ name: 'cpu_avg', type: 'decimal', precision: 5, scale: 2, nullable: true, transformer: decimalANumero })
  cpuAvg!: number | null;

  @Column({ name: 'cpu_max', type: 'decimal', precision: 5, scale: 2, nullable: true, transformer: decimalANumero })
  cpuMax!: number | null;

  @Column({ name: 'ram_avg', type: 'decimal', precision: 5, scale: 2, nullable: true, transformer: decimalANumero })
  ramAvg!: number | null;

  @Column({ name: 'ram_max', type: 'decimal', precision: 5, scale: 2, nullable: true, transformer: decimalANumero })
  ramMax!: number | null;

  /** Errores del Visor de eventos sumados en el día (migración 038). */
  @Column({ name: 'event_errors', type: 'int', default: 0 })
  eventErrors!: number;
}
