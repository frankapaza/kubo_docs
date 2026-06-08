import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ClientRequestSource =
  | 'WHATSAPP_TEXT'
  | 'WHATSAPP_AUDIO'
  | 'VOICE_LIVE'
  | 'NOTE'
  | 'MEETING'
  | 'OTHER';

export type ClientRequestStatus = 'INBOX' | 'STRUCTURED' | 'SENT' | 'ARCHIVED' | 'COMPLETED';

export type ClientRequestType = 'MEJORA' | 'FEATURE' | 'AJUSTE' | 'BUG';

export type ClientRequestPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export type ServiceCategory =
  | 'SOFTWARE'
  | 'SOPORTE'
  | 'CAPACITACION'
  | 'CONSULTA'
  | 'ASESORIA'
  | 'VISITA_SITIO'
  | 'OTRO';

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  'SOFTWARE',
  'SOPORTE',
  'CAPACITACION',
  'CONSULTA',
  'ASESORIA',
  'VISITA_SITIO',
  'OTRO',
];

export const CLIENT_REQUEST_SOURCES: ClientRequestSource[] = [
  'WHATSAPP_TEXT',
  'WHATSAPP_AUDIO',
  'VOICE_LIVE',
  'NOTE',
  'MEETING',
  'OTHER',
];
export const CLIENT_REQUEST_STATUSES: ClientRequestStatus[] = [
  'INBOX',
  'STRUCTURED',
  'SENT',
  'ARCHIVED',
  'COMPLETED',
];
export const CLIENT_REQUEST_TYPES: ClientRequestType[] = [
  'MEJORA',
  'FEATURE',
  'AJUSTE',
  'BUG',
];
export const CLIENT_REQUEST_PRIORITIES: ClientRequestPriority[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
];

@Entity('client_requests')
@Index('idx_cr_client', ['clientId'])
@Index('idx_cr_project', ['projectId'])
@Index('idx_cr_status', ['status'])
@Index('idx_cr_meeting', ['meetingId'])
@Index('idx_cr_created', ['createdAt'])
@Index('idx_cr_assignee', ['assigneeUserId'])
export class ClientRequest {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true, nullable: true })
  clientId!: number | null;

  @Column({ name: 'project_id', type: 'bigint', unsigned: true, nullable: true })
  projectId!: number | null;

  @Column({ name: 'meeting_id', type: 'bigint', unsigned: true, nullable: true })
  meetingId!: number | null;

  @Column({ name: 'parent_request_id', type: 'bigint', unsigned: true, nullable: true })
  parentRequestId!: number | null;

  @Column({ type: 'enum', enum: CLIENT_REQUEST_SOURCES, default: 'NOTE' })
  source!: ClientRequestSource;

  @Column({ name: 'raw_text', type: 'text' })
  rawText!: string;

  @Column({ name: 'raw_audio_filename', type: 'varchar', length: 255, nullable: true })
  rawAudioFilename!: string | null;

  @Column({ name: 'captured_at', type: 'datetime' })
  capturedAt!: Date;

  @Column({ type: 'enum', enum: CLIENT_REQUEST_STATUSES, default: 'INBOX' })
  status!: ClientRequestStatus;

  @Column({ name: 'request_type', type: 'enum', enum: CLIENT_REQUEST_TYPES, nullable: true })
  requestType!: ClientRequestType | null;

  @Column({ name: 'service_category', type: 'enum', enum: SERVICE_CATEGORIES, nullable: true })
  serviceCategory!: ServiceCategory | null;

  @Column({ name: 'scheduled_at', type: 'datetime', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'duration_minutes', type: 'int', unsigned: true, nullable: true })
  durationMinutes!: number | null;

  @Column({ type: 'enum', enum: CLIENT_REQUEST_PRIORITIES, nullable: true })
  priority!: ClientRequestPriority | null;

  @Column({ name: 'module_name', type: 'varchar', length: 80, nullable: true })
  moduleName!: string | null;

  @Column({ name: 'screen_name', type: 'varchar', length: 120, nullable: true })
  screenName!: string | null;

  @Column({ name: 'flow_context', type: 'varchar', length: 200, nullable: true })
  flowContext!: string | null;

  @Column({ type: 'varchar', length: 240, nullable: true })
  title!: string | null;

  @Column({ name: 'description_md', type: 'text', nullable: true })
  descriptionMd!: string | null;

  @Column({ name: 'acceptance_criteria', type: 'json', nullable: true })
  acceptanceCriteria!: string[] | null;

  @Column({ type: 'json', nullable: true })
  labels!: string[] | null;

  @Column({ name: 'assignee_user_id', type: 'bigint', unsigned: true, nullable: true })
  assigneeUserId!: number | null;

  @Column({ name: 'jira_integration_id', type: 'bigint', unsigned: true, nullable: true })
  jiraIntegrationId!: number | null;

  @Column({ name: 'jira_project_key', type: 'varchar', length: 20, nullable: true })
  jiraProjectKey!: string | null;

  @Column({ name: 'jira_issue_key', type: 'varchar', length: 30, nullable: true })
  jiraIssueKey!: string | null;

  @Column({ name: 'jira_issue_url', type: 'varchar', length: 500, nullable: true })
  jiraIssueUrl!: string | null;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'closure_document_id', type: 'bigint', unsigned: true, nullable: true })
  closureDocumentId!: number | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
