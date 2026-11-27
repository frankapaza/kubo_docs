import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { decimalANumero } from './numeric.transformer';

/** Disco reportado por el agente de un servidor. */
export interface AgentDisk {
  name: string;
  totalBytes: number;
  freeBytes: number;
}

/** Grupo de aplicaciones de IIS y su estado («Started», «Stopped», …). */
export interface AgentIisPool {
  name: string;
  state: string;
}

/** Servicio de Windows vigilado y su estado («Running», «Stopped», …). */
export interface AgentServiceStatus {
  name: string;
  status: string;
}

/**
 * Lo que se guarda en `iis`: `pools` es null si el servidor no tiene IIS. Va
 * envuelto porque la columna es JSON NOT NULL y TypeORM escribe un null de
 * JavaScript como NULL de SQL.
 */
export interface AgentIisState {
  pools: AgentIisPool[] | null;
}

/** Muestra periódica del agente de un servidor. */
@Entity('monitor_agent_samples')
@Index('idx_monitor_agent_samples', ['serverId', 'at'])
export class MonitorAgentSample {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'server_id', type: 'bigint', unsigned: true })
  serverId!: number;

  @Column({ type: 'datetime', precision: 3 })
  at!: Date;

  @Column({ name: 'cpu_pct', type: 'decimal', precision: 5, scale: 2, transformer: decimalANumero })
  cpuPct!: number;

  @Column({ name: 'ram_pct', type: 'decimal', precision: 5, scale: 2, transformer: decimalANumero })
  ramPct!: number;

  @Column({ type: 'json' })
  disks!: AgentDisk[];

  @Column({ type: 'json' })
  iis!: AgentIisState;

  /** Servicios de Windows vigilados. */
  @Column({ type: 'json' })
  services!: AgentServiceStatus[];

  @Column({ name: 'event_errors', type: 'int', default: 0 })
  eventErrors!: number;

  @Column({ name: 'agent_version', type: 'varchar', length: 40 })
  agentVersion!: string;
}
