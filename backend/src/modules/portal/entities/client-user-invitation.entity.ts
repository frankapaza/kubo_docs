import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Una invitación para que alguien se dé de alta como usuario de una empresa
 * cliente.
 *
 * **Aquí NO está el secreto.** Solo su huella (`secretFingerprint`). La
 * columna se llama así, y no `token`, para que el nombre delate a quien
 * intente escribir en ella el valor en claro. El secreto solo existe en dos
 * sitios: en memoria durante la petición que lo crea, y en el correo que sale.
 */
@Entity('client_user_invitations')
@Index('idx_cui_client_pendientes', ['clientId', 'usedAt', 'revokedAt'])
@Index('idx_cui_email_vivas', ['email', 'usedAt', 'revokedAt'])
export class ClientUserInvitation {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  /** La empresa. Sale de la sesión de quien invita, jamás del cuerpo. */
  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  /** Ya normalizado por `normalizeEmailAddress` al escribir. */
  @Column({ type: 'varchar', length: 180 })
  email!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 180 })
  fullName!: string;

  /** SHA-256 hexadecimal del secreto. Ver `domain/invitation-secret.ts`. */
  @Column({ name: 'secret_fingerprint', type: 'varchar', length: 64 })
  secretFingerprint!: string;

  @Column({ name: 'invited_by_client_user_id', type: 'bigint', unsigned: true })
  invitedByClientUserId!: number;

  /**
   * Instante absoluto. Se compara con `isInvitationExpired` contra el reloj,
   * nunca contra una fecha civil derivada de la zona del proceso.
   */
  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  /** `null` = sin usar. Se marca dentro de la transacción que crea el usuario. */
  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'accepted_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  acceptedClientUserId!: number | null;

  /**
   * `null` = viva. Se marca al reemplazarla por otra invitación al mismo
   * correo. Es un hecho DISTINTO de `usedAt` y por eso es otra columna: «se
   * reemplazó» y «alguien la usó» no son lo mismo, y un único campo `estado`
   * obligaría a inventar un valor para cuando las dos fueran ciertas.
   */
  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  /** Último intento de envío. `null` = nunca se llegó a intentar. */
  @Column({ name: 'last_sent_at', type: 'datetime', nullable: true })
  lastSentAt!: Date | null;

  /** Por qué falló el último envío. `null` = fue bien, o no hubo intento. */
  @Column({ name: 'send_error', type: 'varchar', length: 500, nullable: true })
  sendError!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
