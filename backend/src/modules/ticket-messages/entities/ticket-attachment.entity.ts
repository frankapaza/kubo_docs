import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Un adjunto colgado de un ticket -- y a veces de un mensaje concreto de su
 * hilo. Tabla creada por la migración 018 (`ticket_attachments`); esta entidad
 * no la altera, solo la describe.
 *
 * `messageId` es `null` cuando el archivo se subió al crear el ticket, antes
 * de que exista ningún mensaje. Por eso `ticketId` (nunca nulo) es lo que
 * decide quién puede ver el adjunto, y `messageId` solo aporta, cuando existe,
 * de qué mensaje concreto cuelga -- y por tanto si ese mensaje es
 * `PUBLICA` o `INTERNA`. Esta tabla no tiene columna de visibilidad propia:
 * `TicketMessagesRepository.listAttachments` la resuelve uniendo con
 * `ticket_messages` (un adjunto sin mensaje es siempre visible, porque nadie
 * puede subirlo como nota interna antes de que el ticket exista).
 *
 * `filename` es lo que subió quien lo mandó -- solo para mostrar, nunca toca
 * el sistema de ficheros. `storageKey` la genera el servidor y es la única que
 * llega a `IStorageService`. `mimeType` es el tipo **detectado** por firma de
 * bytes (`detectMimeType` en `../domain/attachment-rules.ts`), no el
 * declarado por quien sube.
 *
 * **Las dos columnas de subida son excluyentes**, misma invariante y mismo
 * reparto de responsabilidad que en `TicketMessage`: la sostiene el servicio,
 * no el esquema ni esta entidad.
 */
@Entity('ticket_attachments')
@Index('idx_ticket_attachments_ticket', ['ticketId', 'createdAt'])
@Index('idx_ticket_attachments_message', ['messageId'])
export class TicketAttachment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'ticket_id', type: 'bigint', unsigned: true })
  ticketId!: number;

  /** `null` si el adjunto se subió al crear el ticket, antes de que exista ningún mensaje. */
  @Column({ name: 'message_id', type: 'bigint', unsigned: true, nullable: true })
  messageId!: number | null;

  /** Nombre original tal como lo mandó quien sube. Solo para mostrar; nunca decide nada. */
  @Column({ type: 'varchar', length: 255 })
  filename!: string;

  /** Clave generada por el servidor. Única: dos filas con la misma clave dejarían el borrado de una señalando el archivo de la otra. */
  @Column({ name: 'storage_key', type: 'varchar', length: 255, unique: true })
  storageKey!: string;

  /** Tipo detectado por firma de bytes, nunca el `Content-Type` declarado por el navegador. */
  @Column({ name: 'mime_type', type: 'varchar', length: 120 })
  mimeType!: string;

  /**
   * Tamaño real en bytes -- `INT UNSIGNED`, no `BIGINT`: coherente con
   * `MAX_FILE_BYTES` (10 MB) de `../domain/attachment-rules.ts`, muy por debajo
   * de los ~4 GB que admite la columna. A diferencia de las columnas `bigint`
   * de esta entidad, esta sí llega siempre como `number` de verdad.
   */
  @Column({ name: 'size_bytes', type: 'int', unsigned: true })
  sizeBytes!: number;

  /** Quien subió, del equipo. Excluyente con `uploadedByClientUserId`: ver el comentario de la clase. */
  @Column({ name: 'uploaded_by_user_id', type: 'bigint', unsigned: true, nullable: true })
  uploadedByUserId!: number | null;

  /** Quien subió, del cliente. Excluyente con `uploadedByUserId`: ver el comentario de la clase. */
  @Column({ name: 'uploaded_by_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  uploadedByClientUserId!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
