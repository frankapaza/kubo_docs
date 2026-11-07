import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Un par aplicativo+servidor que de hecho ha enviado bajo una instalación:
 * una misma clave la usan varios aplicativos y servidores del cliente, y esto
 * es el inventario de «quién me habla».
 */
@Entity('log_installation_sources')
export class LogInstallationSource {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'installation_id', type: 'bigint', unsigned: true })
  installationId!: number;

  @Column({ type: 'varchar', length: 100 })
  aplicativo!: string;

  @Column({ type: 'varchar', length: 100 })
  servidor!: string;

  @Column({ name: 'appender_version', type: 'varchar', length: 20, nullable: true })
  appenderVersion!: string | null;

  @Column({ name: 'first_seen_at', type: 'datetime', precision: 3 })
  firstSeenAt!: Date;

  @Column({ name: 'last_seen_at', type: 'datetime', precision: 3 })
  lastSeenAt!: Date;
}
