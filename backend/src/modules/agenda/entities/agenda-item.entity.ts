import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('agenda_items')
@Index('idx_agenda_meeting', ['meetingId', 'orderIndex'])
export class AgendaItem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'meeting_id', type: 'bigint', unsigned: true })
  meetingId!: number;

  @Column({ name: 'order_index', type: 'int', default: 0 })
  orderIndex!: number;

  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'duration_minutes', type: 'int', nullable: true })
  durationMinutes!: number | null;
}
