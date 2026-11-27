import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type MonitorSignalType =
  | 'VERIFYING'
  | 'CONFIRMED_FAILURE'
  | 'TRANSIENT_FAILURE'
  | 'RECOVERED'
  | 'DEGRADED'
  | 'DEGRADATION_CLEARED'
  | 'OFFICE_OUTAGE_START'
  | 'OFFICE_OUTAGE_END'
  | 'STATE_SYNC';

/** Señal de una sonda a la central. `(probeId, uuid)` único: la central deduplica por él. */
@Entity('monitor_probe_signals')
@Index('uq_monitor_signal_probe_uuid', ['probeId', 'uuid'], { unique: true })
@Index('idx_monitor_signal_pending', ['processedAt', 'id'])
export class MonitorProbeSignal {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'char', length: 36 })
  uuid!: string;

  @Column({ name: 'probe_id', type: 'bigint', unsigned: true })
  probeId!: number;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true, nullable: true })
  serviceId!: number | null;

  @Column({
    type: 'enum',
    enum: [
      'VERIFYING',
      'CONFIRMED_FAILURE',
      'TRANSIENT_FAILURE',
      'RECOVERED',
      'DEGRADED',
      'DEGRADATION_CLEARED',
      'OFFICE_OUTAGE_START',
      'OFFICE_OUTAGE_END',
      'STATE_SYNC',
    ],
  })
  type!: MonitorSignalType;

  @Column({ type: 'datetime', precision: 3 })
  at!: Date;

  @Column({ name: 'first_failure_at', type: 'datetime', precision: 3, nullable: true })
  firstFailureAt!: Date | null;

  @Column({ name: 'received_at', type: 'datetime', precision: 3 })
  receivedAt!: Date;

  @Column({ name: 'processed_at', type: 'datetime', precision: 3, nullable: true })
  processedAt!: Date | null;

  @Column({ name: 'awaiting_cross_until', type: 'datetime', precision: 3, nullable: true })
  awaitingCrossUntil!: Date | null;

  @Column({ name: 'cross_order_id', type: 'bigint', unsigned: true, nullable: true })
  crossOrderId!: number | null;
}
