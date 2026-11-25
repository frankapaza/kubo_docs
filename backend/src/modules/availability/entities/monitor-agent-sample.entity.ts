import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { decimalANumero } from './numeric.transformer';

/** Disco reportado por el agente de un servidor. */
export interface AgentDisk {
  name: string;
  totalBytes: number;
  freeBytes: number;
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

  /** Estado de IIS; la Task 6 lo tipa. */
  @Column({ type: 'json' })
  iis!: unknown;

  /** Servicios de Windows vigilados; la Task 6 lo tipa. */
  @Column({ type: 'json' })
  services!: unknown;

  @Column({ name: 'event_errors', type: 'int', default: 0 })
  eventErrors!: number;

  @Column({ name: 'agent_version', type: 'varchar', length: 40 })
  agentVersion!: string;
}
