import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('acta_signatures')
@Index('uq_acta_participant', ['actaId', 'participantId'], { unique: true })
export class ActaSignature {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'acta_id', type: 'bigint', unsigned: true })
  actaId!: number;

  @Column({ name: 'participant_id', type: 'bigint', unsigned: true })
  participantId!: number;

  @Column({ name: 'signed_by_user', type: 'bigint', unsigned: true, nullable: true })
  signedByUser!: number | null;

  @Column({ name: 'signer_name', type: 'varchar', length: 180 })
  signerName!: string;

  @Column({ name: 'signer_document', type: 'varchar', length: 40, nullable: true })
  signerDocument!: string | null;

  @Column({ name: 'signer_role', type: 'varchar', length: 80, nullable: true })
  signerRole!: string | null;

  @Column({ name: 'signature_hash', type: 'varchar', length: 128 })
  signatureHash!: string;

  /**
   * Cómo firmó (migración 042): USER = con su usuario; IN_PERSON = trazo en el iPad;
   * EMAIL = confirmó desde el enlace de su correo; BOTH = trazo y confirmación por correo.
   */
  @Column({ type: 'varchar', length: 12, default: 'USER' })
  method!: 'USER' | 'IN_PERSON' | 'EMAIL' | 'BOTH';

  /** Trazo manuscrito (PNG). Fuera de los listados: se lee para el PDF y la imagen. */
  @Column({ name: 'signature_png', type: 'mediumblob', nullable: true, select: false })
  signaturePng?: Buffer | null;

  @Column({ name: 'confirm_email', type: 'varchar', length: 180, nullable: true })
  confirmEmail!: string | null;

  /** SHA-256 del enlace de confirmación; null una vez usado. Nunca el enlace en claro. */
  @Column({ name: 'confirm_token_hash', type: 'char', length: 64, nullable: true, select: false })
  confirmTokenHash?: string | null;

  @Column({ name: 'confirm_expires_at', type: 'datetime', nullable: true })
  confirmExpiresAt!: Date | null;

  @Column({ name: 'email_confirmed_at', type: 'datetime', precision: 3, nullable: true })
  emailConfirmedAt!: Date | null;

  @CreateDateColumn({ name: 'signed_at' })
  signedAt!: Date;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress!: string | null;
}
