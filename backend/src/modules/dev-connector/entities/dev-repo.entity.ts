import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Un repo de GitHub registrado y la asignación cliente-sistema que es su alcance. Migración 031. */
@Entity('dev_repos')
export class DevRepo {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_system_id', type: 'bigint', unsigned: true })
  clientSystemId!: number;

  /** `owner/repo`, siempre en minúsculas. */
  @Column({ name: 'github_full_name', type: 'varchar', length: 140 })
  githubFullName!: string;

  /** Cifrado con `encryptSecret`; nunca sale en una respuesta. */
  @Column({ name: 'webhook_secret_enc', type: 'text', nullable: true, select: false })
  webhookSecretEnc!: string | null;

  @Column({ name: 'is_active', type: 'tinyint', width: 1, default: 1 })
  isActive!: number;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
