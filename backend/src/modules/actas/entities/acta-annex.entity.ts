import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Evidencia del acta (migración 042): foto y/o texto. `place` ANEXO = al final del PDF
 * como «Anexo N»; INLINE = dentro de su sección (`section`). Solo si hay alguna.
 */
@Entity('acta_annexes')
export class ActaAnnex {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'acta_id', type: 'bigint', unsigned: true })
  actaId!: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  position!: number;

  @Column({ type: 'varchar', length: 40, nullable: true })
  section!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'ANEXO' })
  place!: 'ANEXO' | 'INLINE';

  @Column({ type: 'text', nullable: true })
  caption!: string | null;

  /** Foto (JPEG/PNG). Fuera de los listados: se lee para el PDF y la imagen. */
  @Column({ type: 'mediumblob', nullable: true, select: false })
  image?: Buffer | null;

  @Column({ name: 'image_mime', type: 'varchar', length: 40, nullable: true })
  imageMime!: string | null;

  @Column({ name: 'created_by_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByUserId!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
