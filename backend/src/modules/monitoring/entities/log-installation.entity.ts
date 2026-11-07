import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { LogLevel } from '../domain/log-level';

/**
 * Una identidad que envía logs (una clave). Ver la migración 030.
 *
 * CLIENTE cuelga de una asignación cliente-sistema (`clientSystemId`; cliente
 * y producto salen de ella, no se copian aquí para que no puedan discrepar).
 * INTERNA es un aplicativo propio de la casa (`name`, `systemId` opcional).
 *
 * De la clave solo vive `keyFingerprint` (SHA-256): la clave en claro se
 * muestra una vez al emitirla y no se guarda en ninguna parte.
 */
@Entity('log_installations')
export class LogInstallation {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'enum', enum: ['CLIENTE', 'INTERNA'] })
  kind!: 'CLIENTE' | 'INTERNA';

  @Column({ name: 'client_system_id', type: 'bigint', unsigned: true, nullable: true })
  clientSystemId!: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  @Column({ name: 'system_id', type: 'bigint', unsigned: true, nullable: true })
  systemId!: number | null;

  @Column({ name: 'min_level', type: 'enum', enum: ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'], default: 'INFO' })
  minLevel!: LogLevel;

  @Column({ name: 'key_fingerprint', type: 'char', length: 64, nullable: true })
  keyFingerprint!: string | null;

  @Column({ name: 'key_prefix', type: 'varchar', length: 12, nullable: true })
  keyPrefix!: string | null;

  @Column({ name: 'key_created_at', type: 'datetime', nullable: true })
  keyCreatedAt!: Date | null;

  @Column({ name: 'key_revoked_at', type: 'datetime', nullable: true })
  keyRevokedAt!: Date | null;

  @Column({ name: 'last_seen_at', type: 'datetime', precision: 3, nullable: true })
  lastSeenAt!: Date | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
