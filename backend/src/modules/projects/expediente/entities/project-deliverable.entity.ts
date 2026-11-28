import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { DeliverableStatus, Phase, Requirement } from '../deliverable-catalog';

/** Un entregable del expediente del proyecto (migración 043). */
@Entity('project_deliverables')
export class ProjectDeliverable {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'project_id', type: 'bigint', unsigned: true })
  projectId!: number;

  @Column({ type: 'int', unsigned: true })
  correlative!: number;

  @Column({ type: 'varchar', length: 10 })
  type!: string;

  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ type: 'varchar', length: 16 })
  phase!: Phase;

  @Column({ type: 'varchar', length: 2 })
  requirement!: Requirement;

  @Column({ type: 'varchar', length: 12, default: 'PENDIENTE' })
  status!: DeliverableStatus;

  @Column({ name: 'na_reason', type: 'varchar', length: 300, nullable: true })
  naReason!: string | null;

  @Column({ name: 'auto_na', type: 'tinyint', width: 1, default: 0 })
  autoNa!: number;

  @Column({ name: 'from_catalog', type: 'tinyint', width: 1, default: 1 })
  fromCatalog!: number;

  @Column({ name: 'version_major', type: 'int', unsigned: true, default: 0 })
  versionMajor!: number;

  @Column({ name: 'version_minor', type: 'int', unsigned: true, default: 0 })
  versionMinor!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
