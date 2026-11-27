import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type MonitorEntityStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

/** Servidor de un cliente que se vigila. Sus servicios cuelgan de él. */
@Entity('monitor_servers')
export class MonitorServer {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  host!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  role!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  region!: string | null;

  @Column({ type: 'enum', enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'], default: 'ACTIVE' })
  status!: MonitorEntityStatus;

  @Column({ name: 'agent_token_hash', type: 'char', length: 64, nullable: true })
  agentTokenHash!: string | null;

  @Column({ name: 'agent_last_seen_at', type: 'datetime', precision: 3, nullable: true })
  agentLastSeenAt!: Date | null;

  /** Servicios de Windows que el agente debe vigilar. */
  @Column({ name: 'agent_watch_services', type: 'json', nullable: true })
  agentWatchServices!: string[] | null;

  @Column({ name: 'agent_token_created_at', type: 'datetime', precision: 3, nullable: true })
  agentTokenCreatedAt!: Date | null;

  /** Cuándo se avisó del silencio del agente; NULL = sin aviso pendiente. */
  @Column({ name: 'agent_silence_alerted_at', type: 'datetime', precision: 3, nullable: true })
  agentSilenceAlertedAt!: Date | null;

  @Column({ name: 'agent_version', type: 'varchar', length: 40, nullable: true })
  agentVersion!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
