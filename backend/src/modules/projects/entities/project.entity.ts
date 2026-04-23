import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ length: 30, unique: true })
  code!: string;

  @Column({ name: 'jira_code', type: 'varchar', length: 10, nullable: true })
  jiraCode!: string | null;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true, nullable: true })
  clientId!: number | null;

  @Column({ length: 180 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' })
  status!: ProjectStatus;

  @Column({ name: 'jira_integration_id', type: 'bigint', unsigned: true, nullable: true })
  jiraIntegrationId!: number | null;

  @Column({ name: 'jira_project_key', type: 'varchar', length: 20, nullable: true })
  jiraProjectKey!: string | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
