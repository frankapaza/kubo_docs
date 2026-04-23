import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('agreements')
@Index('idx_agreements_acta', ['actaId', 'orderIndex'])
export class Agreement {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'acta_id', type: 'bigint', unsigned: true })
  actaId!: number;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'order_index', type: 'int', default: 0 })
  orderIndex!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
