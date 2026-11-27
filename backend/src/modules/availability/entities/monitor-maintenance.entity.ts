import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Ventana de mantenimiento: de un servidor o de un servicio (exactamente uno). */
@Entity('monitor_maintenance')
export class MonitorMaintenance {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'server_id', type: 'bigint', unsigned: true, nullable: true })
  serverId!: number | null;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true, nullable: true })
  serviceId!: number | null;

  @Column({ name: 'starts_at', type: 'datetime', precision: 3 })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'datetime', precision: 3 })
  endsAt!: Date;

  @Column({ type: 'varchar', length: 255 })
  reason!: string;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
