import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Línea de tiempo de un incidente. */
@Entity('monitor_incident_events')
export class MonitorIncidentEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'incident_id', type: 'bigint', unsigned: true })
  incidentId!: number;

  @Column({ type: 'datetime', precision: 3 })
  at!: Date;

  @Column({ type: 'varchar', length: 40 })
  type!: string;

  @Column({ type: 'json', nullable: true })
  detail!: Record<string, unknown> | null;

  @Column({ name: 'author_user_id', type: 'bigint', unsigned: true, nullable: true })
  authorUserId!: number | null;
}
