import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_log')
@Index('idx_audit_entity', ['entityType', 'entityId'])
@Index('idx_audit_user', ['userId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true, nullable: true })
  userId!: number | null;

  @Column({ type: 'varchar', length: 80 })
  action!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 60 })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 60, nullable: true })
  entityId!: string | null;

  @Column({ name: 'payload_json', type: 'json', nullable: true })
  payloadJson!: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
