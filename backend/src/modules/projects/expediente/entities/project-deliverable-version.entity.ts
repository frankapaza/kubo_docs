import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** E elaborado | R revisado | A aprobado | F firmado | N no aplica | P reabierto. */
export type DeliverableHistoryAction = 'E' | 'R' | 'A' | 'F' | 'N' | 'P';

/** Una fila del historial de revisiones de un entregable (migración 043). */
@Entity('project_deliverable_versions')
export class ProjectDeliverableVersion {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'deliverable_id', type: 'bigint', unsigned: true })
  deliverableId!: number;

  @Column({ type: 'varchar', length: 2 })
  action!: DeliverableHistoryAction;

  @Column({ name: 'version_major', type: 'int', unsigned: true })
  versionMajor!: number;

  @Column({ name: 'version_minor', type: 'int', unsigned: true })
  versionMinor!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 255, nullable: true })
  storageKey!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  filename!: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true })
  mimeType!: string | null;

  @Column({ name: 'size_bytes', type: 'int', unsigned: true, nullable: true })
  sizeBytes!: number | null;

  /** Documento en línea de esta versión (JSON de secciones), migración 044. No se lee en los listados. */
  @Column({ name: 'content_json', type: 'mediumtext', nullable: true, select: false })
  contentJson!: string | null;

  @Column({ name: 'actor_user_id', type: 'bigint', unsigned: true, nullable: true })
  actorUserId!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
