import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Estructura de secciones de un tipo de entregable: Kubo (client_id 0) o de un cliente (migración 044). */
@Entity('deliverable_templates')
export class DeliverableTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 10 })
  type!: string;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true, default: 0 })
  clientId!: number;

  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ name: 'sections_json', type: 'text' })
  sectionsJson!: string;

  @Column({ name: 'updated_by', type: 'bigint', unsigned: true, nullable: true })
  updatedBy!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
