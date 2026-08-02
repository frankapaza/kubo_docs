import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

import { NotificationAudience } from '../domain/template-renderer';

/**
 * Fila de aviso editable desde el panel. Sembrada con siete filas por la
 * migración 015 (`backend/sql/migrations/015_notificaciones.sql`, secciones
 * 3-4); esta entidad no la crea ni la altera, solo la lee y la edita.
 *
 * Columnas contrastadas una a una contra el esquema real el 2026-08-02:
 *   docker exec kubo-mysql-dev mysql -uroot -proot -e
 *     "USE kubo_devdocs; SHOW CREATE TABLE notification_templates\G"
 *
 * Con `synchronize: false` un `@Column({ name })` que no coincida con la
 * base no falla al compilar: falla en tiempo de ejecución, con
 * `ER_BAD_FIELD_ERROR` en el primer SELECT/UPDATE.
 */
@Entity('notification_templates')
export class NotificationTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'trigger_key', type: 'varchar', length: 60 })
  triggerKey!: string;

  /**
   * Público al que se dirige la plantilla. Deliberadamente sin `nullable` ni
   * lógica de escritura fuera de la siembra: **no es editable**. Cambiarlo
   * convertiría una plantilla revisada para un lector en otra cosa sin que
   * nadie la volviera a revisar; por eso ni el DTO de edición lo admite ni
   * el servicio lo copiaría aunque llegara.
   */
  @Column({ type: 'enum', enum: ['CLIENT', 'TEAM'] })
  audience!: NotificationAudience;

  @Column({ type: 'varchar', length: 300 })
  subject!: string;

  @Column({ name: 'body_md', type: 'text' })
  bodyMd!: string;

  /** Apagarla desactiva ese aviso concreto, sin tocar código. */
  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  /** Quién del equipo la editó por última vez. `null` mientras nadie la toque. */
  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, nullable: true })
  updatedBy!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
