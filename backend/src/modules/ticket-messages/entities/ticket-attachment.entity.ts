import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Un adjunto colgado de un **mensaje** del hilo de un ticket. Tabla creada por
 * la migración 018 (`ticket_attachments`); esta entidad no la altera, solo la
 * describe.
 *
 * **Todo adjunto cuelga de un mensaje**, y de ahí sale todo lo demás. Esta
 * tabla no tiene columna de visibilidad propia: la hereda de la del mensaje.
 * `TicketAttachmentsService.upload` exige `messageId` y el alta del ticket
 * crea el ticket **con su primer mensaje** antes de subir nada, así que no
 * queda ningún camino que escriba una fila sin él.
 *
 * `messageId` sigue siendo `NULL`-able en el esquema **solo por las filas
 * anteriores a esa decisión**, y una fila así es una **anomalía**, no un caso
 * normal: sin mensaje no hereda ninguna visibilidad, y un adjunto cuya
 * visibilidad nadie eligió no se le puede enseñar a un cliente. Por eso
 * `TicketMessagesRepository.listAttachments` resuelve la lista del cliente con
 * un `INNER JOIN` contra `ticket_messages` --para quien no es del equipo, el
 * huérfano no existe-- y la descarga contesta 404. Al equipo sí le existe, que
 * es quien tiene que poder verlo.
 *
 * Este párrafo decía lo contrario --«`messageId` es `null` cuando el archivo se
 * subió al crear el ticket… un adjunto sin mensaje es siempre visible»-- y se
 * deja anotado a propósito: era la premisa de la que salió la rama
 * `message_id IS NULL OR …` que dejaba pasar **siempre** al huérfano a la
 * lista del cliente. La rama se cerró; el contrato que la justificaba seguía
 * escrito aquí, que es lo que desactiva la sospecha del siguiente que lo lea.
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

  /**
   * El mensaje del que cuelga. **Ningún camino de escritura lo deja vacío**;
   * es `NULL`-able solo por las filas anteriores a esa decisión, y un `null`
   * aquí es una anomalía --un adjunto sin visibilidad heredada--, no el caso
   * normal. Ver el comentario de la clase.
   */
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
