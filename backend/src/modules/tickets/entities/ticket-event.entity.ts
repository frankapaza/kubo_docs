import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TicketStatus, TICKET_STATUSES } from '../domain/ticket-state-machine';

export type TicketEventType =
  | 'CREATED'
  | 'TRIAGED'
  | 'ASSIGNED'
  | 'TAKEN'
  | 'STATUS_CHANGED'
  | 'ESCALATED'
  | 'COMMENT'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'
  | 'SLA_AT_RISK'
  | 'PRIORITY_OVERRIDDEN';

export const TICKET_EVENT_TYPES: TicketEventType[] = [
  'CREATED',
  'TRIAGED',
  'ASSIGNED',
  'TAKEN',
  'STATUS_CHANGED',
  'ESCALATED',
  'COMMENT',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'SLA_AT_RISK',
  'PRIORITY_OVERRIDDEN',
];

/** Append-only: nunca se actualiza ni se borra. Es la evidencia auditable. */
@Entity('ticket_events')
@Index('idx_ticket_events_ticket', ['ticketId', 'createdAt'])
export class TicketEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'ticket_id', type: 'bigint', unsigned: true })
  ticketId!: number;

  @Column({ type: 'enum', enum: TICKET_EVENT_TYPES })
  type!: TicketEventType;

  @Column({ name: 'from_status', type: 'enum', enum: TICKET_STATUSES, nullable: true })
  fromStatus!: TicketStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: TICKET_STATUSES, nullable: true })
  toStatus!: TicketStatus | null;

  @Column({ name: 'actor_user_id', type: 'bigint', unsigned: true, nullable: true })
  actorUserId!: number | null;

  @Column({ name: 'actor_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  actorClientUserId!: number | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'json', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
