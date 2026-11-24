import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Orden de la central a una sonda: comprobación manual o cruzada. */
@Entity('monitor_probe_orders')
export class MonitorProbeOrder {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'probe_id', type: 'bigint', unsigned: true })
  probeId!: number;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId!: number;

  @Column({ type: 'enum', enum: ['MANUAL', 'CROSS'] })
  kind!: 'MANUAL' | 'CROSS';

  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'taken_at', type: 'datetime', precision: 3, nullable: true })
  takenAt!: Date | null;

  @Column({ name: 'done_at', type: 'datetime', precision: 3, nullable: true })
  doneAt!: Date | null;
}
