import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Episodio de lentitud de un ping: de la primera hora lenta a la primera normal (migración 041). */
@Entity('monitor_latency_episodes')
export class MonitorLatencyEpisode {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId!: number;

  @Column({ name: 'started_hour', type: 'datetime' })
  startedHour!: Date;

  /** Primera hora normal; null mientras sigue abierto. */
  @Column({ name: 'ended_hour', type: 'datetime', nullable: true })
  endedHour!: Date | null;

  /** Todos los pings lentos a la vez al abrirse: probable internet de la oficina. */
  @Column({ name: 'office_wide', type: 'boolean', default: false })
  officeWide!: boolean;

  @Column({ name: 'closed_reason', type: 'varchar', length: 20, nullable: true })
  closedReason!: 'NORMAL' | 'SERVICE_INACTIVE' | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
