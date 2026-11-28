import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Resumen de una hora de pings (ICMP) medidos desde la oficina (migración 041).
 * `hourStart` es el inicio de la hora en UTC. `slow` cuenta los pings sobre el
 * umbral o fallidos; `isSlow` marca la hora con ≥ 20 % de ellos.
 */
@Entity('monitor_latency_hours')
export class MonitorLatencyHour {
  @PrimaryColumn({ name: 'service_id', type: 'bigint', unsigned: true })
  serviceId!: number;

  @PrimaryColumn({ name: 'hour_start', type: 'datetime' })
  hourStart!: Date;

  @Column({ type: 'int', unsigned: true })
  total!: number;

  @Column({ type: 'int', unsigned: true })
  slow!: number;

  @Column({ name: 'avg_ms', type: 'int', unsigned: true, nullable: true })
  avgMs!: number | null;

  @Column({ name: 'p95_ms', type: 'int', unsigned: true, nullable: true })
  p95Ms!: number | null;

  @Column({ name: 'max_ms', type: 'int', unsigned: true, nullable: true })
  maxMs!: number | null;

  @Column({ name: 'threshold_ms', type: 'int', unsigned: true })
  thresholdMs!: number;

  @Column({ name: 'is_slow', type: 'boolean', default: false })
  isSlow!: boolean;
}
