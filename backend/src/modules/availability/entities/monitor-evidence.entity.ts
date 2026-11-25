import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type MonitorEvidenceOrigin = 'OFICINA' | 'SERVIDOR' | 'OTRO';

/** Evidencia (captura, archivo) adjunta a un incidente. */
@Entity('monitor_evidence')
export class MonitorEvidence {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'incident_id', type: 'bigint', unsigned: true })
  incidentId!: number;

  @Column({ name: 'captured_at', type: 'datetime', precision: 3 })
  capturedAt!: Date;

  @Column({ type: 'enum', enum: ['OFICINA', 'SERVIDOR', 'OTRO'] })
  origin!: MonitorEvidenceOrigin;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 255 })
  storageKey!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes!: number;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
