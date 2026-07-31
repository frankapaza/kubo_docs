import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TicketStatus, TICKET_STATUSES } from '../domain/ticket-state-machine';
import {
  TicketImpact,
  TicketUrgency,
  TicketPriority,
  TICKET_IMPACTS,
  TICKET_URGENCIES,
  TICKET_PRIORITIES,
} from '../domain/ticket-priority';

export type TicketOrigin =
  | 'EMAIL'
  | 'WHATSAPP_TEXT'
  | 'WHATSAPP_AUDIO'
  | 'VOICE_LIVE'
  | 'MEETING'
  | 'NOTE'
  | 'PORTAL';

export type TicketRequestType = 'INCIDENCIA' | 'BUG' | 'MEJORA' | 'FEATURE' | 'AJUSTE';

export type ServiceCategory =
  | 'SOFTWARE'
  | 'SOPORTE'
  | 'CAPACITACION'
  | 'CONSULTA'
  | 'ASESORIA'
  | 'VISITA_SITIO'
  | 'OTRO';

export type AgentLevel = 'N1' | 'N2' | 'N3';

export const TICKET_ORIGINS: TicketOrigin[] = [
  'EMAIL',
  'WHATSAPP_TEXT',
  'WHATSAPP_AUDIO',
  'VOICE_LIVE',
  'MEETING',
  'NOTE',
  'PORTAL',
];

export const TICKET_REQUEST_TYPES: TicketRequestType[] = [
  'INCIDENCIA',
  'BUG',
  'MEJORA',
  'FEATURE',
  'AJUSTE',
];

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  'SOFTWARE',
  'SOPORTE',
  'CAPACITACION',
  'CONSULTA',
  'ASESORIA',
  'VISITA_SITIO',
  'OTRO',
];

export const AGENT_LEVELS: AgentLevel[] = ['N1', 'N2', 'N3'];

@Entity('tickets')
@Index('idx_tickets_client', ['clientId'])
@Index('idx_tickets_status', ['status'])
@Index('idx_tickets_assignee', ['assigneeUserId'])
@Index('idx_tickets_resolution_due', ['slaResolutionDueAt'])
export class Ticket {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  code!: string | null;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true, nullable: true })
  clientId!: number | null;

  @Column({ name: 'project_id', type: 'bigint', unsigned: true, nullable: true })
  projectId!: number | null;

  @Column({ name: 'system_id', type: 'bigint', unsigned: true, nullable: true })
  systemId!: number | null;

  @Column({ name: 'meeting_id', type: 'bigint', unsigned: true, nullable: true })
  meetingId!: number | null;

  @Column({ type: 'enum', enum: TICKET_ORIGINS, default: 'NOTE' })
  origin!: TicketOrigin;

  @Column({ name: 'request_type', type: 'enum', enum: TICKET_REQUEST_TYPES, nullable: true })
  requestType!: TicketRequestType | null;

  @Column({ name: 'service_category', type: 'enum', enum: SERVICE_CATEGORIES, nullable: true })
  serviceCategory!: ServiceCategory | null;

  @Column({ type: 'varchar', length: 240, nullable: true })
  subject!: string | null;

  @Column({ name: 'raw_text', type: 'text' })
  rawText!: string;

  @Column({ name: 'raw_audio_filename', type: 'varchar', length: 255, nullable: true })
  rawAudioFilename!: string | null;

  @Column({ name: 'description_md', type: 'text', nullable: true })
  descriptionMd!: string | null;

  @Column({ name: 'acceptance_criteria', type: 'json', nullable: true })
  acceptanceCriteria!: string[] | null;

  @Column({ type: 'json', nullable: true })
  labels!: string[] | null;

  @Column({ name: 'module_name', type: 'varchar', length: 80, nullable: true })
  moduleName!: string | null;

  @Column({ name: 'screen_name', type: 'varchar', length: 120, nullable: true })
  screenName!: string | null;

  @Column({ name: 'flow_context', type: 'varchar', length: 200, nullable: true })
  flowContext!: string | null;

  @Column({ type: 'enum', enum: TICKET_IMPACTS, nullable: true })
  impact!: TicketImpact | null;

  @Column({ type: 'enum', enum: TICKET_URGENCIES, nullable: true })
  urgency!: TicketUrgency | null;

  @Column({ type: 'enum', enum: TICKET_PRIORITIES, default: 'P3' })
  priority!: TicketPriority;

  @Column({ name: 'priority_overridden', type: 'tinyint', default: 0 })
  priorityOverridden!: number;

  @Column({ type: 'enum', enum: TICKET_STATUSES, default: 'NUEVO' })
  status!: TicketStatus;

  @Column({ name: 'assignee_user_id', type: 'bigint', unsigned: true, nullable: true })
  assigneeUserId!: number | null;

  @Column({ name: 'escalation_level', type: 'enum', enum: AGENT_LEVELS, nullable: true })
  escalationLevel!: AgentLevel | null;

  @Column({ name: 'sla_policy_id', type: 'bigint', unsigned: true, nullable: true })
  slaPolicyId!: number | null;

  @Column({ name: 'sla_response_due_at', type: 'datetime', nullable: true })
  slaResponseDueAt!: Date | null;

  @Column({ name: 'sla_resolution_due_at', type: 'datetime', nullable: true })
  slaResolutionDueAt!: Date | null;

  @Column({ name: 'first_response_at', type: 'datetime', nullable: true })
  firstResponseAt!: Date | null;

  @Column({ name: 'paused_at', type: 'datetime', nullable: true })
  pausedAt!: Date | null;

  @Column({ name: 'paused_total_seconds', type: 'int', unsigned: true, default: 0 })
  pausedTotalSeconds!: number;

  @Column({ name: 'sla_at_risk', type: 'tinyint', default: 0 })
  slaAtRisk!: number;

  @Column({ name: 'captured_at', type: 'datetime' })
  capturedAt!: Date;

  @Column({ name: 'attended_at', type: 'datetime', nullable: true })
  attendedAt!: Date | null;

  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'resolution_md', type: 'text', nullable: true })
  resolutionMd!: string | null;

  @Column({ name: 'root_cause', type: 'text', nullable: true })
  rootCause!: string | null;

  @Column({ name: 'corrective_action', type: 'text', nullable: true })
  correctiveAction!: string | null;

  @Column({ name: 'scheduled_at', type: 'datetime', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'duration_minutes', type: 'int', unsigned: true, nullable: true })
  durationMinutes!: number | null;

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

  @Column({ name: 'closure_document_id', type: 'bigint', unsigned: true, nullable: true })
  closureDocumentId!: number | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
