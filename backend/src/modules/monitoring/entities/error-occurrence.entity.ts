import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Una muestra con detalle de un grupo. Se guardan solo las últimas 50 por
 * grupo: bastan para diagnosticar sin ir a Loki y no crecen sin límite
 * aunque el error se repita millones de veces.
 */
@Entity('error_occurrences')
export class ErrorOccurrence {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'group_id', type: 'bigint', unsigned: true })
  groupId!: number;

  @Column({ name: 'occurred_at', type: 'datetime', precision: 3 })
  occurredAt!: Date;

  @Column({ type: 'varchar', length: 100 })
  servidor!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  hilo!: string | null;

  @Column({ type: 'varchar', length: 255 })
  logger!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'text', nullable: true })
  exception!: string | null;

  @Column({ type: 'json', nullable: true })
  properties!: Record<string, string> | null;

  @Column({ name: 'received_at', type: 'datetime', precision: 3 })
  receivedAt!: Date;
}
