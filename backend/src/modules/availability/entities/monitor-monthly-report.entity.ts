import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { AvailabilityReportData } from '../domain/availability-report';

export type { AvailabilityReportData };

/** Informe mensual congelado de un cliente. `month` es 'YYYY-MM'. */
@Entity('monitor_monthly_reports')
@Index('uq_monitor_monthly_report', ['clientId', 'month'], { unique: true })
export class MonitorMonthlyReport {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  @Column({ type: 'char', length: 7 })
  month!: string;

  @Column({ type: 'boolean', default: false })
  partial!: boolean;

  @Column({ name: 'generated_at', type: 'datetime', precision: 3 })
  generatedAt!: Date;

  @Column({ name: 'generated_by', type: 'bigint', unsigned: true, nullable: true })
  generatedBy!: number | null;

  @Column({ type: 'json' })
  data!: AvailabilityReportData;
}
