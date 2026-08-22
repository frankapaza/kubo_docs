import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type AudioRetentionPolicy =
  | 'KEEP_FOREVER'
  | 'DELETE_AFTER_APPROVAL'
  | 'DELETE_AFTER_DAYS'
  | 'NEVER_STORE';

export const AUDIO_RETENTION_POLICIES: AudioRetentionPolicy[] = [
  'KEEP_FOREVER',
  'DELETE_AFTER_APPROVAL',
  'DELETE_AFTER_DAYS',
  'NEVER_STORE',
];

@Entity('workspace_settings')
export class WorkspaceSetting {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'razon_social', type: 'varchar', length: 200 })
  razonSocial!: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  ruc!: string | null;

  @Column({ name: 'legal_rep_name', type: 'varchar', length: 180, nullable: true })
  legalRepName!: string | null;

  @Column({ name: 'legal_rep_doc', type: 'varchar', length: 20, nullable: true })
  legalRepDoc!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  website!: string | null;

  @Column({ name: 'logo_url', type: 'varchar', length: 500, nullable: true })
  logoUrl!: string | null;

  // ========== Sesión ==========
  @Column({ name: 'session_timeout_minutes', type: 'int', default: 30 })
  sessionTimeoutMinutes!: number;

  // ========== SMTP ==========
  @Column({ name: 'smtp_host', type: 'varchar', length: 255, nullable: true })
  smtpHost!: string | null;

  @Column({ name: 'smtp_port', type: 'int', nullable: true })
  smtpPort!: number | null;

  @Column({ name: 'smtp_secure', type: 'tinyint', default: 0 })
  smtpSecure!: number;

  @Column({ name: 'smtp_user', type: 'varchar', length: 255, nullable: true })
  smtpUser!: string | null;

  @Column({ name: 'smtp_pass_encrypted', type: 'text', nullable: true })
  smtpPassEncrypted!: string | null;

  @Column({ name: 'smtp_from', type: 'varchar', length: 255, nullable: true })
  smtpFrom!: string | null;

  /**
   * Buzón del equipo (migración 015). Es la única dirección interna a la que
   * llegan los avisos de tickets: no se avisa a todos los ADMIN uno por uno,
   * porque eso convertiría cada alta de un usuario interno en un cambio
   * silencioso de la lista de distribución. Vacío ⇒ se cae a `smtpFrom`.
   */
  @Column({ name: 'team_inbox_email', type: 'varchar', length: 180, nullable: true })
  teamInboxEmail!: string | null;

  // ========== IMAP (correo entrante, Task 8) ==========
  // Migración 023, junto a la de SMTP de arriba: mismo criterio, columnas
  // nulas hasta que alguien configura el buzón, contraseña cifrada con la
  // misma `aes-gcm.util.ts`.
  @Column({ name: 'imap_host', type: 'varchar', length: 255, nullable: true })
  imapHost!: string | null;

  @Column({ name: 'imap_port', type: 'int', nullable: true })
  imapPort!: number | null;

  @Column({ name: 'imap_secure', type: 'tinyint', default: 1 })
  imapSecure!: number;

  @Column({ name: 'imap_user', type: 'varchar', length: 255, nullable: true })
  imapUser!: string | null;

  @Column({ name: 'imap_pass_encrypted', type: 'text', nullable: true })
  imapPassEncrypted!: string | null;

  @Column({ name: 'imap_folder', type: 'varchar', length: 255, nullable: true })
  imapFolder!: string | null;

  /**
   * El interruptor de encendido de la ingesta. Nace apagado (`DEFAULT 0` en
   * la 023): un correo mal recibido crea tickets o responde a desconocidos
   * solo, así que hay que encenderlo a mano, y solo tras verificar la
   * política SMTP de rechazo en el servidor real (ver el docblock de
   * `judgeAuthentication`).
   */
  @Column({ name: 'imap_enabled', type: 'tinyint', default: 0 })
  imapEnabled!: number;

  /**
   * El identificador del propio servidor de correo (`authserv-id`, RFC 8601
   * §2.2 -- el primer segmento de `Authentication-Results`, antes del primer
   * `;`). Migración 024, tanda de cierre: sin este ancla, `evaluateDmarc`
   * (`domain/intake-rules.ts`) descartaba ese segmento sin comprobar nunca su
   * valor, y un remitente que escribe su propia cabecera dentro de su propio
   * mensaje puede fabricarlo sin ninguna dificultad -- ver el docblock de
   * `judgeAuthentication`, sección "El ancla que faltaba". `NULL` hasta que
   * alguien lo configura a mano falla cerrado (`SIN_SERVIDOR_PROPIO` para
   * todo correo), nunca se adivina.
   */
  @Column({ name: 'imap_auth_server_id', type: 'varchar', length: 255, nullable: true })
  imapAuthServerId!: string | null;

  // ========== Retención de audio ==========
  @Column({
    name: 'audio_retention_policy',
    type: 'enum',
    enum: AUDIO_RETENTION_POLICIES,
    default: 'DELETE_AFTER_DAYS',
  })
  audioRetentionPolicy!: AudioRetentionPolicy;

  @Column({ name: 'audio_retention_days', type: 'int', default: 7 })
  audioRetentionDays!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
