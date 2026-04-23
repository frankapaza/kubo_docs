import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SignatoryKind = 'INTERNAL' | 'EXTERNAL';
export type ConformityStatus = 'PENDING' | 'SIGNED' | 'REFUSED' | 'ABSENT_EARLY' | 'ABSENT';

export const CONFORMITY_STATUSES: ConformityStatus[] = [
  'PENDING',
  'SIGNED',
  'REFUSED',
  'ABSENT_EARLY',
  'ABSENT',
];

@Entity('document_signatories')
@Index('idx_ds_document', ['documentId'])
@Index('idx_ds_user', ['userId'])
export class DocumentSignatory {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'document_id', type: 'bigint', unsigned: true })
  documentId!: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true, nullable: true })
  userId!: number | null;

  @Column({ type: 'enum', enum: ['INTERNAL', 'EXTERNAL'], default: 'EXTERNAL' })
  kind!: SignatoryKind;

  @Column({ name: 'full_name', length: 180 })
  fullName!: string;

  @Column({ name: 'document_number', type: 'varchar', length: 40, nullable: true })
  documentNumber!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  role!: string | null;

  @Column({
    name: 'conformity_status',
    type: 'enum',
    enum: CONFORMITY_STATUSES,
    default: 'PENDING',
  })
  conformityStatus!: ConformityStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes!: string | null;

  @Column({ name: 'signature_token', type: 'varchar', length: 100, nullable: true, unique: true })
  signatureToken!: string | null;

  @Column({ name: 'token_expires_at', type: 'datetime', nullable: true })
  tokenExpiresAt!: Date | null;

  @Column({ name: 'signed_at', type: 'datetime', nullable: true })
  signedAt!: Date | null;

  @Column({ name: 'signed_ip', type: 'varchar', length: 45, nullable: true })
  signedIp!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
