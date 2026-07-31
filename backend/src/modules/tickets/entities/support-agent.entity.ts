import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AgentLevel, AGENT_LEVELS, ServiceCategory } from './ticket.entity';

@Entity('support_agents')
export class SupportAgent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: number;

  @Column({ type: 'enum', enum: AGENT_LEVELS, default: 'N1' })
  level!: AgentLevel;

  @Column({ type: 'json', nullable: true })
  specialties!: ServiceCategory[] | null;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
