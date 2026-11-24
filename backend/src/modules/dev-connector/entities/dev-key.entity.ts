import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Clave `kdev_` de un desarrollador para un repo. Solo vive la huella SHA-256:
 * la clave en claro se muestra una vez al emitirla. Migración 031.
 */
@Entity('dev_keys')
export class DevKey {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'dev_repo_id', type: 'bigint', unsigned: true })
  devRepoId!: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: number;

  @Column({ name: 'key_fingerprint', type: 'char', length: 64 })
  keyFingerprint!: string;

  @Column({ name: 'key_prefix', type: 'varchar', length: 12 })
  keyPrefix!: string;

  @Column({ name: 'last_used_at', type: 'datetime', precision: 3, nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
