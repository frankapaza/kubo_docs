import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DocumentType =
  | 'CONTRACT'
  | 'QUOTE'
  | 'NDA'
  | 'SOW'
  | 'TDR'
  | 'ADDENDUM'
  | 'OTHER';

export const DOCUMENT_TYPES: DocumentType[] = [
  'CONTRACT',
  'QUOTE',
  'NDA',
  'SOW',
  'TDR',
  'ADDENDUM',
  'OTHER',
];

export interface TemplateVariable {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'number' | 'date' | 'email';
  source: 'client' | 'workspace' | 'manual' | 'auto' | 'ai';
  required: boolean;
  defaultValue?: string | number;
}

export interface TemplateVariablesSchema {
  variables: TemplateVariable[];
}

@Entity('document_templates')
@Index('idx_document_templates_type', ['type'])
export class DocumentTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'enum', enum: DOCUMENT_TYPES, default: 'OTHER' })
  type!: DocumentType;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'content_markdown', type: 'mediumtext' })
  contentMarkdown!: string;

  @Column({ name: 'variables_schema', type: 'json' })
  variablesSchema!: TemplateVariablesSchema;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
