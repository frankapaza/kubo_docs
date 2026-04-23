import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AudioSource = 'WEB' | 'MOBILE';

@Entity('audio_files')
@Index('idx_audio_meeting', ['meetingId'])
export class AudioFile {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'meeting_id', type: 'bigint', unsigned: true })
  meetingId!: number;

  @Column({ name: 'uploaded_by', type: 'bigint', unsigned: true })
  uploadedBy!: number;

  @Column({ name: 'storage_key', length: 500 })
  storageKey!: string;

  @Column({ name: 'original_filename', length: 255 })
  originalFilename!: string;

  @Column({ name: 'mime_type', length: 80 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint', unsigned: true })
  sizeBytes!: number;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds!: number | null;

  @Column({ name: 'checksum_sha256', type: 'varchar', length: 64, nullable: true })
  checksumSha256!: string | null;

  @Column({ type: 'enum', enum: ['WEB', 'MOBILE'] })
  source!: AudioSource;

  // Null si el archivo aún está guardado; datetime si fue borrado por retención.
  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt!: Date | null;

  // Razón del borrado: NEVER_STORE | AFTER_APPROVAL | AFTER_DAYS | MANUAL
  @Column({ name: 'deleted_reason', type: 'varchar', length: 50, nullable: true })
  deletedReason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
