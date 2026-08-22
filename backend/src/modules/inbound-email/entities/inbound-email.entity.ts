import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Por qué terminó así el procesamiento de un correo, se haya generado ticket o
 * no. `DESCARTADO_POR_TOPE` es el desenlace de **dos** topes distintos (Task
 * 7, `domain/throttle.ts`): el de respuestas a un remitente desconocido
 * (`InboundEmailsRepository.countRepliesToUnknown`, por dirección y global) y
 * el de tickets nuevos por dirección y hora (`countNewTicketsByAddress`).
 * `REMITENTE_DESCONOCIDO`, en cambio, es la respuesta que sí se mandó -- la
 * que el primero de esos dos topes cuenta para decidir la siguiente. El
 * resto de valores es lo que hace falta para poder responder después "por
 * qué no entró éste" sin tener que releer el correo original, que puede
 * haber caducado en el buzón.
 */
export type InboundEmailOutcome =
  | 'TICKET_CREADO'
  | 'MENSAJE_ANADIDO'
  | 'DESCARTADO_NO_AUTENTICADO'
  | 'DESCARTADO_AUTOMATICO'
  | 'DESCARTADO_PROPIO'
  | 'DESCARTADO_DUPLICADO'
  | 'REMITENTE_DESCONOCIDO'
  | 'DESCARTADO_POR_TOPE'
  /**
   * Migración 022. Un correo legítimo y autenticado que, simplemente, no deja
   * nada que escribir: el personal referenciando un ticket que no existe (por
   * cabecera ni por código en el asunto -- el personal no abre tickets por
   * correo), o una respuesta cuyo cuerpo queda vacío tras recortar la cita del
   * hilo anterior y que tampoco trae ningún adjunto del que dejar constancia.
   * Deliberadamente distinto de `ERROR`: no es un fallo del sistema, y no debe
   * sumar a ese contador ni ofrecerse para reintentar -- un reintento no
   * cambia nada en un correo que seguirá sin ticket o sin texto.
   */
  | 'DESCARTADO_SIN_CONTENIDO'
  | 'ERROR';

export const INBOUND_EMAIL_OUTCOMES: readonly InboundEmailOutcome[] = [
  'TICKET_CREADO',
  'MENSAJE_ANADIDO',
  'DESCARTADO_NO_AUTENTICADO',
  'DESCARTADO_AUTOMATICO',
  'DESCARTADO_PROPIO',
  'DESCARTADO_DUPLICADO',
  'REMITENTE_DESCONOCIDO',
  'DESCARTADO_POR_TOPE',
  'DESCARTADO_SIN_CONTENIDO',
  'ERROR',
];

/**
 * Un registro por cada correo recibido, se procese como se procese —también
 * los que se descartan. Tabla creada por la migración 021 (`inbound_emails`);
 * esta entidad no la altera, solo la describe. Ver la cabecera de esa
 * migración para el porqué de cada columna.
 *
 * **Dos columnas de identificador, y no es redundancia.** `messageId` es
 * `ascii`, indexada y la que sostiene la correlación (incluida la clave única
 * que hace la ingesta idempotente); cuando el valor crudo no era ASCII lleva
 * un sustituto determinista en vez del original. `messageIdRaw` es `utf8mb4`,
 * sin indexar, el valor tal cual llegó. Es **nulable a propósito**: `null`
 * significa "no se capturó el valor crudo", y una cadena vacía queda libre
 * para el día en que un correo real traiga un Message-ID vacío de verdad. Ver
 * la sección 1 de la migración 021 para la historia completa (incluye una
 * corrección sobre una versión anterior de esta misma migración).
 */
@Entity('inbound_emails')
@Index('idx_inbound_outcome', ['outcome', 'createdAt'])
export class InboundEmail {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  /** Identificador para correlacionar; hash del valor crudo si este no era ASCII. */
  @Column({ name: 'message_id', type: 'varchar', length: 998 })
  messageId!: string;

  /** Message-ID tal cual llegó, sin transformar. `null` = no capturado. */
  @Column({ name: 'message_id_raw', type: 'varchar', length: 998, nullable: true })
  messageIdRaw!: string | null;

  @Column({ name: 'from_address', type: 'varchar', length: 320 })
  fromAddress!: string;

  @Column({ type: 'varchar', length: 998, nullable: true })
  subject!: string | null;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'received_at', type: 'datetime' })
  receivedAt!: Date;

  @Column({ type: 'enum', enum: INBOUND_EMAIL_OUTCOMES })
  outcome!: InboundEmailOutcome;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'ticket_id', type: 'bigint', unsigned: true, nullable: true })
  ticketId!: number | null;

  @Column({ name: 'client_user_id', type: 'bigint', unsigned: true, nullable: true })
  clientUserId!: number | null;

  @Column({ name: 'attachment_count', type: 'int', unsigned: true, default: 0 })
  attachmentCount!: number;

  @Column({ name: 'attachment_names', type: 'json', nullable: true })
  attachmentNames!: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
