import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AgentDisk } from './monitor-agent-sample.entity';

/** Resumen diario del agente de un servidor. `date` es 'YYYY-MM-DD'. */
@Entity('monitor_agent_daily_rollups')
@Index('uq_monitor_agent_daily_rollup', ['serverId', 'date'], { unique: true })
export class MonitorAgentDailyRollup {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'server_id', type: 'bigint', unsigned: true })
  serverId!: number;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'int', default: 0 })
  samples!: number;

  @Column({ name: 'cpu_hist', type: 'json' })
  cpuHist!: number[];

  @Column({ name: 'ram_hist', type: 'json' })
  ramHist!: number[];

  @Column({ name: 'disks_close', type: 'json' })
  disksClose!: AgentDisk[];
}
