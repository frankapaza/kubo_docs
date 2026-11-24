import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Caída de la conexión de la oficina vista por su sonda. */
@Entity('monitor_office_outages')
export class MonitorOfficeOutage {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'probe_id', type: 'bigint', unsigned: true })
  probeId!: number;

  @Column({ name: 'started_at', type: 'datetime', precision: 3 })
  startedAt!: Date;

  @Column({ name: 'ended_at', type: 'datetime', precision: 3, nullable: true })
  endedAt!: Date | null;

  @Column({ name: 'affected_services', type: 'int', unsigned: true })
  affectedServices!: number;
}
