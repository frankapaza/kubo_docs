import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type AudioRetentionPolicy =
  | 'KEEP_FOREVER'
  | 'DELETE_AFTER_APPROVAL'
  | 'DELETE_AFTER_DAYS'
  | 'NEVER_STORE';

export const AUDIO_RETENTION_POLICIES: AudioRetentionPolicy[] = [
  'KEEP_FOREVER',
  'DELETE_AFTER_APPROVAL',
  'DELETE_AFTER_DAYS',
  'NEVER_STORE',
];

@Entity('workspace_settings')
export class WorkspaceSetting {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'razon_social', type: 'varchar', length: 200 })
  razonSocial!: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  ruc!: string | null;

  @Column({ name: 'legal_rep_name', type: 'varchar', length: 180, nullable: true })
  legalRepName!: string | null;

  @Column({ name: 'legal_rep_doc', type: 'varchar', length: 20, nullable: true })
  legalRepDoc!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  website!: string | null;

  @Column({ name: 'logo_url', type: 'varchar', length: 500, nullable: true })
  logoUrl!: string | null;

  // ========== Sesión ==========
  @Column({ name: 'session_timeout_minutes', type: 'int', default: 30 })
  sessionTimeoutMinutes!: number;

  // ========== SMTP ==========
  @Column({ name: 'smtp_host', type: 'varchar', length: 255, nullable: true })
  smtpHost!: string | null;

  @Column({ name: 'smtp_port', type: 'int', nullable: true })
  smtpPort!: number | null;

  @Column({ name: 'smtp_secure', type: 'tinyint', default: 0 })
  smtpSecure!: number;

  @Column({ name: 'smtp_user', type: 'varchar', length: 255, nullable: true })
  smtpUser!: string | null;

  @Column({ name: 'smtp_pass_encrypted', type: 'text', nullable: true })
  smtpPassEncrypted!: string | null;

  @Column({ name: 'smtp_from', type: 'varchar', length: 255, nullable: true })
  smtpFrom!: string | null;

  // ========== Retención de audio ==========
  @Column({
    name: 'audio_retention_policy',
    type: 'enum',
    enum: AUDIO_RETENTION_POLICIES,
    default: 'DELETE_AFTER_DAYS',
  })
  audioRetentionPolicy!: AudioRetentionPolicy;

  @Column({ name: 'audio_retention_days', type: 'int', default: 7 })
  audioRetentionDays!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
