import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Nota tomada durante la grabación (migración 042): minuto, tipo y texto. */
@Entity('meeting_notes')
export class MeetingNote {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'meeting_id', type: 'bigint', unsigned: true })
  meetingId!: number;

  @Column({ name: 'offset_sec', type: 'int', unsigned: true })
  offsetSec!: number;

  @Column({ type: 'varchar', length: 10 })
  kind!: 'NOTA' | 'ACUERDO' | 'TAREA';

  @Column({ type: 'varchar', length: 2000 })
  text!: string;

  @Column({ name: 'created_by_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByUserId!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
