import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type IntegrationProvider = 'JIRA';

@Entity('integrations')
export class Integration {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'enum', enum: ['JIRA'] })
  provider!: IntegrationProvider;

  @Column({ type: 'varchar', length: 100 })
  label!: string;

  @Column({ name: 'workspace_url', type: 'varchar', length: 255 })
  workspaceUrl!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ name: 'api_token_encrypted', type: 'text' })
  apiTokenEncrypted!: string;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
