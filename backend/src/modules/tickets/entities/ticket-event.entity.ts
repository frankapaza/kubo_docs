import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TicketStatus, TICKET_STATUSES } from '../domain/ticket-state-machine';

export type TicketEventType =
  | 'CREATED'
  | 'TRIAGED'
  | 'ASSIGNED'
  | 'TAKEN'
  | 'STATUS_CHANGED'
  | 'ESCALATED'
  | 'COMMENT'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'
  | 'SLA_AT_RISK'
  | 'PRIORITY_OVERRIDDEN';

export const TICKET_EVENT_TYPES: TicketEventType[] = [
  'CREATED',
  'TRIAGED',
  'ASSIGNED',
  'TAKEN',
  'STATUS_CHANGED',
  'ESCALATED',
  'COMMENT',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'SLA_AT_RISK',
  'PRIORITY_OVERRIDDEN',
];

/**
 * Append-only: el contenido del evento nunca se actualiza ni se borra. Es la
 * evidencia auditable del ticket.
 *
 * **La única excepción son las tres columnas de notificación del final**, que
 * la migración 015 añadió para usar esta misma tabla como bandeja de salida de
 * los avisos por correo (spec §2). No forman parte del hecho registrado: son
 * la contabilidad de si ese hecho ya se notificó. Las escribe únicamente
 * `NotificationScheduler`, y nadie más debería tocarlas.
 */
@Entity('ticket_events')
@Index('idx_ticket_events_ticket', ['ticketId', 'createdAt'])
@Index('idx_ticket_events_notify', ['notifiedAt', 'id'])
export class TicketEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'ticket_id', type: 'bigint', unsigned: true })
  ticketId!: number;

  @Column({ type: 'enum', enum: TICKET_EVENT_TYPES })
  type!: TicketEventType;

  @Column({ name: 'from_status', type: 'enum', enum: TICKET_STATUSES, nullable: true })
  fromStatus!: TicketStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: TICKET_STATUSES, nullable: true })
  toStatus!: TicketStatus | null;

  @Column({ name: 'actor_user_id', type: 'bigint', unsigned: true, nullable: true })
  actorUserId!: number | null;

  @Column({ name: 'actor_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  actorClientUserId!: number | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'json', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  // ---------------------------------------------------------------------------
  // Bandeja de salida de avisos por correo (migración 015). Ver la cabecera.
  // ---------------------------------------------------------------------------

  /**
   * Cuándo se resolvió el destino de esta fila como aviso. **Nula significa
   * pendiente**, y es lo único que decide qué recoge el vigilante.
   *
   * "Resuelto" no quiere decir "se mandó un correo": también se sella el evento
   * que no genera ningún aviso —el caso mayoritario— y el que agotó los
   * intentos. Lo contrario dejaría la cola creciendo sin fin.
   *
   * La migración la creó sellando de una vez todo el histórico; sin eso, el
   * primer arranque del vigilante habría mandado un correo por cada evento
   * ocurrido desde que existe el sistema.
   */
  @Column({ name: 'notified_at', type: 'datetime', nullable: true })
  notifiedAt!: Date | null;

  /** Intentos de despacho gastados. Ver `NOTIFY_MAX_ATTEMPTS`. */
  @Column({ name: 'notify_attempts', type: 'int', default: 0 })
  notifyAttempts!: number;

  /**
   * Cuándo toca el siguiente intento. **`null` significa "intentable ya"**, no
   * "nunca": es el valor de una fila que todavía no ha fallado ninguna vez.
   *
   * Existe (migración 016) porque sin ella la única referencia temporal era
   * `created_at`, y medir la espera desde ahí hacía que cualquier evento más
   * viejo que el retraso mayor cumpliera todos los retrasos a la vez: gastaba
   * sus tres intentos en tres pasadas seguidas y quedaba abandonado. Es
   * exactamente lo que ocurre cuando el SMTP vuelve de una caída larga y el
   * vigilante encuentra la cola envejecida.
   */
  @Column({ name: 'notify_next_attempt_at', type: 'datetime', nullable: true })
  notifyNextAttemptAt!: Date | null;

  /**
   * El último motivo por el que no salió todo, o por el que no salió nada.
   *
   * `VARCHAR(500)` y MySQL en `STRICT_TRANS_TABLES`: quien escriba aquí tiene
   * que recortar antes (`NOTIFY_ERROR_MAX_LENGTH`), o el propio `UPDATE` que
   * registra el fallo revienta con `ER_DATA_TOO_LONG`.
   */
  @Column({ name: 'notify_last_error', type: 'varchar', length: 500, nullable: true })
  notifyLastError!: string | null;
}
