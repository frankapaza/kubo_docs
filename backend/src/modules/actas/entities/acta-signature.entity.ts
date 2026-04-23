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

  @CreateDateColumn({ name: 'signed_at' })
  signedAt!: Date;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress!: string | null;
}
