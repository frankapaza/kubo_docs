import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Una comprobación hecha por una sonda. El `id` (UUID) lo genera la sonda: la PK es (sonda, id). */
@Entity('monitor_checks')
@Index('idx_monitor_checks_service', ['serviceId', 'probeId', 'startedAt'])
export class MonitorCheck {
  @PrimaryColumn({ name: 'probe_id', type: 'bigint', unsigned: true })
  probeId!: number;

  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId!: number;

  @Column({ type: 'enum', enum: ['REGULAR', 'RETRY', 'MANUAL', 'CROSS'] })
  kind!: 'REGULAR' | 'RETRY' | 'MANUAL' | 'CROSS';

  @Column({ name: 'cycle_at', type: 'datetime', precision: 3 })
  cycleAt!: Date;

  @Column({ name: 'started_at', type: 'datetime', precision: 3 })
  startedAt!: Date;

  @Column({ name: 'duration_ms', type: 'int', unsigned: true })
  durationMs!: number;

  @Column({ type: 'tinyint', width: 1 })
  ok!: boolean;

  @Column({ name: 'error_code', type: 'varchar', length: 20, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'http_status', type: 'int', unsigned: true, nullable: true })
  httpStatus!: number | null;

  @Column({ name: 'order_id', type: 'bigint', unsigned: true, nullable: true })
  orderId!: number | null;

  @Column({ name: 'received_at', type: 'datetime', precision: 3 })
  receivedAt!: Date;
}
