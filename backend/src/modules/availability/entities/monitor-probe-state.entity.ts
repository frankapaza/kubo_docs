import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Último estado conocido de un servicio visto por una sonda. */
@Entity('monitor_probe_states')
export class MonitorProbeState {
  @PrimaryColumn({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId!: number;

  @PrimaryColumn({ name: 'probe_id', type: 'bigint', unsigned: true })
  probeId!: number;

  @Column({ type: 'enum', enum: ['OK', 'VERIFYING', 'FAILED', 'DEGRADED'] })
  state!: 'OK' | 'VERIFYING' | 'FAILED' | 'DEGRADED';

  @Column({ name: 'last_check_at', type: 'datetime', precision: 3, nullable: true })
  lastCheckAt!: Date | null;

  @Column({ name: 'last_ok', type: 'boolean', nullable: true })
  lastOk!: boolean | null;

  @Column({ name: 'last_latency_ms', type: 'int', unsigned: true, nullable: true })
  lastLatencyMs!: number | null;

  @Column({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
