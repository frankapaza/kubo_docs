import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WorkItemStatus, WORK_ITEM_STATUSES } from '../domain/work-item-board';

export type WorkItemEventType =
  | 'CREATED'
  | 'MOVED'
  | 'ASSIGNED'
  | 'COMMENT'
  | 'BLOCKED'
  | 'UNBLOCKED'
  | 'CLOSED'
  | 'REOPENED'
  | 'CANCELLED'
  | 'PRIORITY_CHANGED';

export const WORK_ITEM_EVENT_TYPES: WorkItemEventType[] = [
  'CREATED',
  'MOVED',
  'ASSIGNED',
  'COMMENT',
  'BLOCKED',
  'UNBLOCKED',
  'CLOSED',
  'REOPENED',
  'CANCELLED',
  'PRIORITY_CHANGED',
];

/** Append-only: nunca se actualiza ni se borra. */
@Entity('work_item_events')
@Index('idx_wie_item', ['workItemId', 'createdAt'])
export class WorkItemEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'work_item_id', type: 'bigint', unsigned: true })
  workItemId!: number;

  @Column({ type: 'enum', enum: WORK_ITEM_EVENT_TYPES })
  type!: WorkItemEventType;

  @Column({ name: 'from_status', type: 'enum', enum: WORK_ITEM_STATUSES, nullable: true })
  fromStatus!: WorkItemStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: WORK_ITEM_STATUSES, nullable: true })
  toStatus!: WorkItemStatus | null;

  @Column({ name: 'actor_user_id', type: 'bigint', unsigned: true, nullable: true })
  actorUserId!: number | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'json', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
