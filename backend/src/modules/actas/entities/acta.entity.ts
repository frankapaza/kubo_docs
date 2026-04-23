import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ActaStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'EXPORTED';

@Entity('actas')
export class Acta {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'meeting_id', type: 'bigint', unsigned: true, unique: true })
  meetingId!: number;

  @Column({
    type: 'enum',
    enum: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'EXPORTED'],
    default: 'DRAFT',
  })
  status!: ActaStatus;

  @Column({ name: 'content_markdown', type: 'longtext' })
  contentMarkdown!: string;

  @Column({ name: 'content_json', type: 'json', nullable: true })
  contentJson!: Record<string, unknown> | null;

  @Column({ name: 'generated_from_transcription', type: 'tinyint', default: 0 })
  generatedFromTranscription!: number;

  @Column({ name: 'ai_provider_id', type: 'bigint', unsigned: true, nullable: true })
  aiProviderId!: number | null;

  @Column({ name: 'approved_by', type: 'bigint', unsigned: true, nullable: true })
  approvedBy!: number | null;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'exported_pdf_key', type: 'varchar', length: 500, nullable: true })
  exportedPdfKey!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
