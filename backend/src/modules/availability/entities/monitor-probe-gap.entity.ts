import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type MonitorProbeGapCause = 'OFFICE_OUTAGE' | 'PROBE_SILENT';

/** Hueco en el que una sonda no aportó datos (caída de oficina o silencio). */
@Entity('monitor_probe_gaps')
@Index('idx_monitor_probe_gaps_probe', ['probeId', 'startedAt'])
@Index('idx_monitor_probe_gaps_date', ['date'])
export class MonitorProbeGap {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'probe_id', type: 'bigint', unsigned: true })
  probeId!: number;

  @Column({ name: 'started_at', type: 'datetime', precision: 3 })
  startedAt!: Date;

  @Column({ name: 'ended_at', type: 'datetime', precision: 3 })
  endedAt!: Date;

  @Column({ type: 'enum', enum: ['OFFICE_OUTAGE', 'PROBE_SILENT'] })
  cause!: MonitorProbeGapCause;

  @Column({ type: 'date' })
  date!: string;
}
