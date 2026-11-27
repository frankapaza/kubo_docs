import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Incidente de disponibilidad. Las columnas generadas `open_service_id` y
 * `open_server_parent` (únicas) viven solo en la base: garantizan un único
 * incidente abierto por servicio y uno de servidor por servidor. No se mapean
 * porque son de solo lectura.
 */
@Entity('monitor_incidents')
export class MonitorIncident {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'service_id', type: 'bigint', unsigned: true, nullable: true })
  serviceId!: number | null;

  @Column({ name: 'server_id', type: 'bigint', unsigned: true })
  serverId!: number;

  @Column({ name: 'parent_id', type: 'bigint', unsigned: true, nullable: true })
  parentId!: number | null;

  @Column({ type: 'enum', enum: ['DOWN', 'ROUTE', 'DEGRADED'] })
  kind!: 'DOWN' | 'ROUTE' | 'DEGRADED';

  @Column({ name: 'first_failure_at', type: 'datetime', precision: 3 })
  firstFailureAt!: Date;

  @Column({ name: 'confirmed_at', type: 'datetime', precision: 3 })
  confirmedAt!: Date;

  @Column({ name: 'recovered_at', type: 'datetime', precision: 3, nullable: true })
  recoveredAt!: Date | null;

  @Column({ name: 'close_reason', type: 'enum', enum: ['RECOVERED', 'SERVICE_PAUSED'], nullable: true })
  closeReason!: 'RECOVERED' | 'SERVICE_PAUSED' | null;

  @Column({ name: 'ticket_id', type: 'bigint', unsigned: true, nullable: true })
  ticketId!: number | null;

  @Column({ name: 'acknowledged_by', type: 'bigint', unsigned: true, nullable: true })
  acknowledgedBy!: number | null;

  @Column({ name: 'acknowledged_at', type: 'datetime', precision: 3, nullable: true })
  acknowledgedAt!: Date | null;
}
