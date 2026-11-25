import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import {
  WORK_ITEM_DOC_KINDS,
  WORK_ITEM_DOC_SOURCES,
  WORK_ITEM_DOC_STATUSES,
  WorkItemDocKind,
  WorkItemDocSource,
  WorkItemDocStatus,
} from '../domain/work-item-docs';

/** Un documento de un requerimiento (migración 032). Ver `../domain/work-item-docs.ts`. */
@Entity('work_item_attachments')
@Index('idx_work_item_attachments_item', ['workItemId', 'createdAt'])
export class WorkItemAttachment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'work_item_id', type: 'bigint', unsigned: true })
  workItemId!: number;

  @Column({ type: 'enum', enum: WORK_ITEM_DOC_KINDS, default: 'OTRO' })
  kind!: WorkItemDocKind;

  @Column({ type: 'enum', enum: WORK_ITEM_DOC_STATUSES, default: 'VIGENTE' })
  status!: WorkItemDocStatus;

  @Column({ type: 'enum', enum: WORK_ITEM_DOC_SOURCES, default: 'WEB' })
  source!: WorkItemDocSource;

  /** Ya saneado: puede ir a una cabecera `Content-Disposition`. */
  @Column({ type: 'varchar', length: 255 })
  filename!: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 255, unique: true })
  storageKey!: string;

  /** Detectado por los bytes, nunca el declarado por el navegador. */
  @Column({ name: 'mime_type', type: 'varchar', length: 120 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'int', unsigned: true })
  sizeBytes!: number;

  @Column({ name: 'uploaded_by_user_id', type: 'bigint', unsigned: true, nullable: true })
  uploadedByUserId!: number | null;

  @Column({ name: 'approved_by_user_id', type: 'bigint', unsigned: true, nullable: true })
  approvedByUserId!: number | null;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
