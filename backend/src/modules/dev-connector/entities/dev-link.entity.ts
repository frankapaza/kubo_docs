import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const DEV_LINK_KINDS = ['BRANCH', 'COMMIT', 'PR'] as const;
export type DevLinkKind = (typeof DEV_LINK_KINDS)[number];
export type DevLinkSource = 'WEBHOOK' | 'MCP';

/**
 * Código asociado a un ticket o a un requerimiento (exactamente uno de los
 * dos). Las columnas generadas `ticket_key`/`work_item_key` de la migración 031
 * no se mapean: solo existen para el índice único.
 */
@Entity('dev_links')
export class DevLink {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'dev_repo_id', type: 'bigint', unsigned: true })
  devRepoId!: number;

  @Column({ name: 'ticket_id', type: 'bigint', unsigned: true, nullable: true })
  ticketId!: number | null;

  @Column({ name: 'work_item_id', type: 'bigint', unsigned: true, nullable: true })
  workItemId!: number | null;

  @Column({ type: 'enum', enum: DEV_LINK_KINDS })
  kind!: DevLinkKind;

  @Column({ type: 'varchar', length: 255 })
  ref!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  url!: string | null;

  @Column({ name: 'author_login', type: 'varchar', length: 100, nullable: true })
  authorLogin!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  state!: string | null;

  @Column({ type: 'enum', enum: ['WEBHOOK', 'MCP'] })
  source!: DevLinkSource;

  @Column({ name: 'occurred_at', type: 'datetime' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
