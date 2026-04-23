import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AIProviderKind = 'OPENAI' | 'DEEPSEEK' | 'GEMINI' | 'GROQ';

@Entity('ai_providers')
export class AIProvider {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'enum', enum: ['OPENAI', 'DEEPSEEK', 'GEMINI', 'GROQ'] })
  provider!: AIProviderKind;

  @Column({ type: 'varchar', length: 100 })
  label!: string;

  @Column({ type: 'varchar', length: 100 })
  model!: string;

  @Column({ name: 'api_key_encrypted', type: 'text' })
  apiKeyEncrypted!: string;

  @Column({ name: 'base_url', type: 'varchar', length: 255, nullable: true })
  baseUrl!: string | null;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0.3, transformer: {
    to: (v: number) => v,
    from: (v: string | number) => (typeof v === 'string' ? parseFloat(v) : v),
  } })
  temperature!: number;

  @Column({ name: 'is_active', type: 'tinyint', default: 0 })
  isActive!: number;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
