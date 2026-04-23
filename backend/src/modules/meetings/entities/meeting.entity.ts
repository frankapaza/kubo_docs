import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type MeetingStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'RECORDED'
  | 'TRANSCRIBING'
  | 'TRANSCRIBED'
  | 'ACTA_DRAFT'
  | 'ACTA_APPROVED'
  | 'CLOSED';

export const MEETING_STATUSES: MeetingStatus[] = [
  'SCHEDULED',
  'IN_PROGRESS',
  'RECORDED',
  'TRANSCRIBING',
  'TRANSCRIBED',
  'ACTA_DRAFT',
  'ACTA_APPROVED',
  'CLOSED',
];

export type MeetingType =
  | 'GENERIC'
  | 'DAILY'
  | 'RETROSPECTIVE'
  | 'SPRINT_PLANNING'
  | 'SPRINT_REVIEW'
  | 'POSTMORTEM'
  | 'DISCOVERY';

export const MEETING_TYPES: MeetingType[] = [
  'GENERIC',
  'DAILY',
  'RETROSPECTIVE',
  'SPRINT_PLANNING',
  'SPRINT_REVIEW',
  'POSTMORTEM',
  'DISCOVERY',
];

@Entity('meetings')
@Index('idx_meetings_project', ['projectId'])
@Index('idx_meetings_status', ['status'])
export class Meeting {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'project_id', type: 'bigint', unsigned: true })
  projectId!: number;

  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'scheduled_at', type: 'datetime' })
  scheduledAt!: Date;

  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'ended_at', type: 'datetime', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  location!: string | null;

  @Column({ type: 'enum', enum: MEETING_STATUSES, default: 'SCHEDULED' })
  status!: MeetingStatus;

  @Column({ name: 'meeting_type', type: 'enum', enum: MEETING_TYPES, default: 'GENERIC' })
  meetingType!: MeetingType;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
