import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ErrorGroupStatus } from '../domain/error-group-state';

/**
 * Un error que se repite, una fila (ver la migración 030). La huella es única
 * en toda la tabla: es lo que permite que dos lotes simultáneos del mismo
 * error no creen dos grupos (el segundo choca con la clave única y relee).
 *
 * Los ids de cliente, sistema, ticket y usuario no tienen clave foránea a
 * propósito: el monitoreo no debe bloquear borrados en el portal.
 */
@Entity('error_groups')
export class ErrorGroup {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'char', length: 64 })
  fingerprint!: string;

  @Column({ name: 'installation_id', type: 'bigint', unsigned: true })
  installationId!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true, nullable: true })
  clientId!: number | null;

  @Column({ name: 'system_id', type: 'bigint', unsigned: true, nullable: true })
  systemId!: number | null;

  @Column({ type: 'varchar', length: 100 })
  aplicativo!: string;

  @Column({ name: 'exception_type', type: 'varchar', length: 255, nullable: true })
  exceptionType!: string | null;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'varchar', length: 255 })
  logger!: string;

  @Column({ name: 'first_seen_at', type: 'datetime', precision: 3 })
  firstSeenAt!: Date;

  @Column({ name: 'last_seen_at', type: 'datetime', precision: 3 })
  lastSeenAt!: Date;

  @Column({ name: 'occurrences_total', type: 'int', unsigned: true, default: 0 })
  occurrencesTotal!: number;

  @Column({ type: 'json' })
  servers!: string[];

  @Column({ type: 'enum', enum: ['NUEVO', 'CON_TICKET', 'RESUELTO'], default: 'NUEVO' })
  status!: ErrorGroupStatus;

  @Column({ name: 'reopened_at', type: 'datetime', nullable: true })
  reopenedAt!: Date | null;

  @Column({ name: 'reopen_reason', type: 'varchar', length: 200, nullable: true })
  reopenReason!: string | null;

  @Column({ name: 'ticket_id', type: 'bigint', unsigned: true, nullable: true })
  ticketId!: number | null;

  @Column({ name: 'ticket_linked_by', type: 'bigint', unsigned: true, nullable: true })
  ticketLinkedBy!: number | null;

  @Column({ name: 'ticket_linked_at', type: 'datetime', nullable: true })
  ticketLinkedAt!: Date | null;

  @Column({ name: 'resolved_by', type: 'bigint', unsigned: true, nullable: true })
  resolvedBy!: number | null;

  @Column({ name: 'resolved_at', type: 'datetime', precision: 3, nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
