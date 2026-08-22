import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * `PUBLICA` la ve el cliente en el portal; `INTERNA` no, en ningún caso. Es la
 * única columna que separa las dos cosas -- por eso va en el `WHERE` de
 * cualquier lectura que pueda llegar a un cliente, nunca en un filtro
 * posterior en memoria (ver `TicketMessagesRepository`).
 *
 * Sin valor por omisión en la migración 018 a propósito: un `INSERT` que se
 * olvide de esta columna revienta con `ER_NO_DEFAULT_FOR_FIELD` en vez de
 * guardar en silencio como nota interna un mensaje que el cliente escribió.
 */
export type TicketMessageVisibility = 'PUBLICA' | 'INTERNA';

/**
 * De solo lectura, y no por higiene: es la fuente de verdad del filtro con el
 * que `NotificationDispatcher` decide si un `MESSAGE_POSTED` fue público, y de
 * ahí sale si un correo va hacia fuera. Un `push` desde cualquier otro módulo
 * --o un `sort` en un test-- cambiaría en caliente qué se considera una
 * visibilidad legítima. El `readonly` lo impide en tiempo de compilación.
 */
export const TICKET_MESSAGE_VISIBILITIES: readonly TicketMessageVisibility[] = [
  'PUBLICA',
  'INTERNA',
];

/**
 * Un mensaje del hilo de un ticket -- respuesta pública o nota interna, según
 * `visibility`. Tabla creada por la migración 018 (`ticket_messages`); esta
 * entidad no la altera, solo la describe.
 *
 * **Las dos columnas de autor son excluyentes: exactamente una debe llevar un
 * id y la otra debe ser `null`.** El esquema no lo impone (dos espacios de
 * identificadores distintos, `users` y `client_users`; un CHECK que solo
 * contara nulos no evitaría el error real, que es poner el id de un cliente en
 * la columna del equipo) y esta entidad tampoco: la invariante la sostiene el
 * servicio que escribe el mensaje, no el esquema ni el ORM. Que las dos sean
 * `number | null` -- y no, por ejemplo, una unión discriminada -- es a
 * propósito: TypeORM hidrata columnas `bigint` como cadena, y forzar aquí un
 * tipo más estricto solo daría una falsa sensación de garantía sobre datos que
 * de verdad hay que revisar mensaje a mensaje.
 */
@Entity('ticket_messages')
@Index('idx_ticket_messages_ticket', ['ticketId', 'createdAt'])
export class TicketMessage {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'ticket_id', type: 'bigint', unsigned: true })
  ticketId!: number;

  @Column({ name: 'body_md', type: 'text' })
  bodyMd!: string;

  /**
   * El cuerpo completo del correo entrante, sin recortar (migración 021).
   * `bodyMd` sigue siendo lo que se enseña en el hilo — el texto nuevo, sin la
   * cita de la conversación anterior que arrastra cada respuesta. `null` en
   * cualquier mensaje que no vino de un correo, y también en uno que sí vino
   * pero cuyo cuerpo completo no se conservó.
   */
  @Column({ name: 'body_full', type: 'mediumtext', nullable: true })
  bodyFull!: string | null;

  @Column({ type: 'enum', enum: TICKET_MESSAGE_VISIBILITIES })
  visibility!: TicketMessageVisibility;

  /** Autor del equipo. Excluyente con `authorClientUserId`: ver el comentario de la clase. */
  @Column({ name: 'author_user_id', type: 'bigint', unsigned: true, nullable: true })
  authorUserId!: number | null;

  /** Autor del cliente. Excluyente con `authorUserId`: ver el comentario de la clase. */
  @Column({ name: 'author_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  authorClientUserId!: number | null;

  /**
   * De qué correo entrante salió este mensaje, si vino de uno (migración
   * 021). `null` para cualquier mensaje escrito desde el panel o el portal.
   */
  @Column({ name: 'inbound_email_id', type: 'bigint', unsigned: true, nullable: true })
  inboundEmailId!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
