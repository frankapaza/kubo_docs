import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Clave de la API de integración de un cliente (migración 040). Solo se guarda
 * la huella SHA-256 y un prefijo para reconocerla; la clave en claro se
 * muestra una vez, al crearla. Es de la empresa: sobrevive a quien la creó.
 */
@Entity('client_api_keys')
@Index('idx_client_api_keys_client', ['clientId', 'revokedAt'])
export class ClientApiKey {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'key_prefix', type: 'char', length: 8 })
  keyPrefix!: string;

  @Column({ name: 'key_hash', type: 'char', length: 64, unique: true })
  keyHash!: string;

  @Column({ name: 'created_by_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByUserId!: number | null;

  @Column({ name: 'created_by_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByClientUserId!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'last_used_at', type: 'datetime', precision: 3, nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'datetime', precision: 3, nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'revoked_by_user_id', type: 'bigint', unsigned: true, nullable: true })
  revokedByUserId!: number | null;

  @Column({ name: 'revoked_by_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  revokedByClientUserId!: number | null;
}
