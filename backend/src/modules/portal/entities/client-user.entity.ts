import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

/** Usuario de una empresa cliente. Deliberadamente fuera de `users`. */
@Entity('client_users')
@Index('idx_cu_client', ['clientId'])
export class ClientUser {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  @Column({ type: 'varchar', length: 180 })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 180 })
  fullName!: string;

  /**
   * Gobierna `ClientAdminGuard`: solo el usuario de cliente con `isAdmin` en
   * `true` puede pedir requerimientos desde el portal (ver
   * `client-admin.guard.ts`).
   */
  @Column({ name: 'is_admin', type: 'tinyint', default: 0 })
  isAdmin!: number;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt!: Date | null;

  /**
   * Quién del equipo lo dio de alta. **Nulable desde la 026**: cuando quien
   * invita es un administrador de cliente no hay ningún miembro del personal
   * a quien apuntar, y rellenarlo con uno inventado es exactamente el defecto
   * recurrente de este proyecto —decidir por la ausencia de un valor en vez
   * de por el hecho que lo determina—. Un vacío honesto es mejor que un
   * `created_by` que atribuye el alta a alguien que no hizo nada.
   */
  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  /**
   * El administrador de cliente que invitó, cuando el alta vino del portal.
   * Columna aparte y no un `created_by` polimórfico: `users` y `client_users`
   * son tablas distintas a propósito (ver la 013) y un mismo entero no puede
   * significar una fila de una o de otra según el viento.
   *
   * Las dos a la vez, nunca: o lo dio de alta el personal, o lo invitó un
   * administrador de cliente.
   */
  @Column({ name: 'created_by_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByClientUserId!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
