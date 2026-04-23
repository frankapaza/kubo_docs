import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CommitmentStatus = 'OPEN' | 'DONE' | 'CANCELLED';

@Entity('commitments')
@Index('idx_commitments_acta', ['actaId'])
@Index('idx_commitments_status', ['status'])
export class Commitment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'acta_id', type: 'bigint', unsigned: true })
  actaId!: number;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'assignee_user_id', type: 'bigint', unsigned: true, nullable: true })
  assigneeUserId!: number | null;

  @Column({ name: 'assignee_name', type: 'varchar', length: 180, nullable: true })
  assigneeName!: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: Date | null;

  @Column({ type: 'enum', enum: ['OPEN', 'DONE', 'CANCELLED'], default: 'OPEN' })
  status!: CommitmentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
