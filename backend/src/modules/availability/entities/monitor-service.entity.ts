import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { MonitorEntityStatus } from './monitor-server.entity';

/** Un servicio sondeado (TCP, HTTPS o ICMP) de un servidor. */
@Entity('monitor_services')
export class MonitorService {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'server_id', type: 'bigint', unsigned: true })
  serverId!: number;

  /** `client_systems.id`: el sistema del cliente al que sirve, si aplica. */
  @Column({ name: 'system_id', type: 'bigint', unsigned: true, nullable: true })
  systemId!: number | null;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'enum', enum: ['TCP', 'HTTPS', 'HTTP', 'ICMP'] })
  protocol!: 'TCP' | 'HTTPS' | 'HTTP' | 'ICMP';

  @Column({ type: 'varchar', length: 255 })
  target!: string;

  @Column({ type: 'int', unsigned: true, nullable: true })
  port!: number | null;

  @Column({ name: 'latency_threshold_ms', type: 'int', default: 1500 })
  latencyThresholdMs!: number;

  @Column({ type: 'enum', enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'MEDIUM' })
  criticality!: 'HIGH' | 'MEDIUM' | 'LOW';

  @Column({ name: 'schedule_override', type: 'json', nullable: true })
  scheduleOverride!: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'], default: 'ACTIVE' })
  status!: MonitorEntityStatus;

  @Column({ name: 'last_manual_check_at', type: 'datetime', precision: 3, nullable: true })
  lastManualCheckAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
