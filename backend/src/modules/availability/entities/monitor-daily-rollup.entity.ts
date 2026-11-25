import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { decimalANumero } from './numeric.transformer';

/** Resumen diario de un servicio visto por una sonda. `date` es 'YYYY-MM-DD'. */
@Entity('monitor_daily_rollups')
@Index('uq_monitor_daily_rollup', ['serviceId', 'probeId', 'date'], { unique: true })
@Index('idx_monitor_daily_rollups_date', ['date'])
export class MonitorDailyRollup {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId!: number;

  @Column({ name: 'probe_id', type: 'bigint', unsigned: true })
  probeId!: number;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'int', default: 0 })
  expected!: number;

  @Column({ type: 'int', default: 0 })
  executed!: number;

  @Column({ type: 'int', default: 0 })
  succeeded!: number;

  @Column({ name: 'p50_ms', type: 'int', nullable: true })
  p50Ms!: number | null;

  @Column({ name: 'p95_ms', type: 'int', nullable: true })
  p95Ms!: number | null;

  /** Histograma de latencias: arreglo de conteos. */
  @Column({ name: 'latency_hist', type: 'json' })
  latencyHist!: number[];

  @Column({ name: 'down_minutes', type: 'decimal', precision: 8, scale: 2, default: 0, transformer: decimalANumero })
  downMinutes!: number;

  @Column({ name: 'route_minutes', type: 'decimal', precision: 8, scale: 2, default: 0, transformer: decimalANumero })
  routeMinutes!: number;

  @Column({ name: 'no_data_minutes', type: 'decimal', precision: 8, scale: 2, default: 0, transformer: decimalANumero })
  noDataMinutes!: number;
}
