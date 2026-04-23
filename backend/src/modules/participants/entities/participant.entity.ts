import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('participants')
@Index('idx_participants_meeting', ['meetingId'])
export class Participant {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'meeting_id', type: 'bigint', unsigned: true })
  meetingId!: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true, nullable: true })
  userId!: number | null;

  @Column({ name: 'full_name', length: 180 })
  fullName!: string;

  @Column({ name: 'document_number', type: 'varchar', length: 40, nullable: true })
  documentNumber!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  role!: string | null;

  @Column({ type: 'tinyint', default: 0 })
  attended!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
