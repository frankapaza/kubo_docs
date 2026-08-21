import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  WorkItemStatus,
  WORK_ITEM_STATUSES,
  WorkItemPriority,
  WORK_ITEM_PRIORITIES,
} from '../domain/work-item-board';

/** Cómo nació el requerimiento. Es el hecho que decide si el cliente lo ve. */
export type WorkItemOrigin = 'INTERNO' | 'PORTAL';

export const WORK_ITEM_ORIGINS: WorkItemOrigin[] = ['INTERNO', 'PORTAL'];

@Entity('work_items')
@Index('idx_wi_client', ['clientId'])
@Index('idx_wi_status', ['status'])
@Index('idx_wi_board', ['status', 'boardOrder'])
export class WorkItem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  code!: string | null;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  /**
   * `INTERNO` para todo lo que nace dentro de casa (actas, reuniones, Jira, el
   * tablero); `PORTAL` para lo que pidió el cliente.
   *
   * **Es el único criterio de visibilidad del portal**, y está separado de
   * `createdByClientUserId` a propósito: quién lo creó y si el cliente puede
   * verlo son dos hechos distintos.
   */
  @Column({ type: 'enum', enum: WORK_ITEM_ORIGINS, default: 'INTERNO' })
  origin!: WorkItemOrigin;

  @Column({ name: 'project_id', type: 'bigint', unsigned: true, nullable: true })
  projectId!: number | null;

  @Column({ type: 'varchar', length: 240 })
  title!: string;

  @Column({ name: 'description_md', type: 'text', nullable: true })
  descriptionMd!: string | null;

  @Column({ name: 'acceptance_criteria', type: 'json', nullable: true })
  acceptanceCriteria!: string[] | null;

  @Column({ type: 'json', nullable: true })
  labels!: string[] | null;

  @Column({ type: 'enum', enum: WORK_ITEM_STATUSES, default: 'PENDIENTE' })
  status!: WorkItemStatus;

  @Column({ type: 'enum', enum: WORK_ITEM_PRIORITIES, default: 'MEDIA' })
  priority!: WorkItemPriority;

  @Column({ name: 'assignee_user_id', type: 'bigint', unsigned: true, nullable: true })
  assigneeUserId!: number | null;

  @Column({ name: 'board_order', type: 'int', unsigned: true, default: 0 })
  boardOrder!: number;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt!: Date | null;

  /** Nulo cuando lo creó un usuario de cliente desde el portal. */
  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  /** Nulo salvo que lo creara un usuario de cliente. Columna de la migración 013. */
  @Column({ name: 'created_by_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByClientUserId!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
