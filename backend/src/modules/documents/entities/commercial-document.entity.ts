import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DOCUMENT_TYPES, DocumentType } from './document-template.entity';

export type CommercialDocumentStatus =
  | 'DRAFT'
  | 'SENT'
  | 'SIGNED'
  | 'EXPIRED'
  | 'CANCELLED';

export const COMMERCIAL_DOCUMENT_STATUSES: CommercialDocumentStatus[] = [
  'DRAFT',
  'SENT',
  'SIGNED',
  'EXPIRED',
  'CANCELLED',
];

@Entity('commercial_documents')
@Index('idx_commercial_documents_client', ['clientId'])
@Index('idx_commercial_documents_meeting', ['meetingId'])
@Index('idx_commercial_documents_status', ['status'])
export class CommercialDocument {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  @Column({ name: 'template_id', type: 'bigint', unsigned: true, nullable: true })
  templateId!: number | null;

  @Column({ name: 'meeting_id', type: 'bigint', unsigned: true, nullable: true })
  meetingId!: number | null;

  @Column({ name: 'project_id', type: 'bigint', unsigned: true, nullable: true })
  projectId!: number | null;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'enum', enum: DOCUMENT_TYPES, default: 'OTHER' })
  type!: DocumentType;

  @Column({ type: 'enum', enum: COMMERCIAL_DOCUMENT_STATUSES, default: 'DRAFT' })
  status!: CommercialDocumentStatus;

  @Column({ name: 'content_markdown', type: 'mediumtext' })
  contentMarkdown!: string;

  @Column({ name: 'variables_values', type: 'json', nullable: true })
  variablesValues!: Record<string, string | number | null> | null;

  @Column({ name: 'pdf_key', type: 'varchar', length: 255, nullable: true })
  pdfKey!: string | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
