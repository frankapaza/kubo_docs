import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Día ya resumido en monitor_daily_rollups. `date` es 'YYYY-MM-DD'. */
@Entity('monitor_rollup_days')
export class MonitorRollupDay {
  @PrimaryColumn({ type: 'date' })
  date!: string;

  @Column({ name: 'computed_at', type: 'datetime', precision: 3 })
  computedAt!: Date;
}
