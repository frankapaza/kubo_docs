import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER';

@Entity('project_members')
@Index('uq_project_members', ['projectId', 'userId'], { unique: true })
export class ProjectMember {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'project_id', type: 'bigint', unsigned: true })
  projectId!: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: number;

  @Column({
    name: 'role_in_project',
    type: 'enum',
    enum: ['OWNER', 'EDITOR', 'VIEWER'],
    default: 'VIEWER',
  })
  roleInProject!: ProjectRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
