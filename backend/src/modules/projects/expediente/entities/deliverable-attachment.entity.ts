import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type AttachmentPlace = 'INLINE' | 'ANEXO';

/** Imagen de una sección del documento: figura en la sección o anexo al final (migración 044). */
@Entity('deliverable_attachments')
export class DeliverableAttachment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'deliverable_id', type: 'bigint', unsigned: true })
  deliverableId!: number;

  @Column({ name: 'section_key', type: 'varchar', length: 40 })
  sectionKey!: string;

  @Column({ type: 'varchar', length: 6, default: 'INLINE' })
  place!: AttachmentPlace;

  @Column({ type: 'varchar', length: 500, nullable: true })
  caption!: string | null;

  @Column({ type: 'int', unsigned: true })
  position!: number;

  /** No se lee en los listados: solo al servir la imagen o armar el PDF. */
  @Column({ type: 'mediumblob', select: false })
  image!: Buffer;

  @Column({ name: 'image_mime', type: 'varchar', length: 20 })
  imageMime!: string;

  @Column({ name: 'created_by_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByUserId!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
