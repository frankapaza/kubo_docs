import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TranscriptionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

@Entity('transcriptions')
export class Transcription {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'audio_file_id', type: 'bigint', unsigned: true, unique: true })
  audioFileId!: number;

  @Column({
    type: 'enum',
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
  })
  status!: TranscriptionStatus;

  @Column({ length: 50, default: 'whisper-api' })
  provider!: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  language!: string | null;

  @Column({ name: 'content_text', type: 'longtext', nullable: true })
  contentText!: string | null;

  @Column({ name: 'content_segments_json', type: 'json', nullable: true })
  contentSegmentsJson!: unknown;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'datetime', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
