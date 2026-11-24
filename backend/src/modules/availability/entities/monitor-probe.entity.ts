import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Una sonda (oficina o centro de datos). La migración siembra `oficina-01` y `kubo-01`. */
@Entity('monitor_probes')
export class MonitorProbe {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 60, unique: true })
  code!: string;

  @Column({ type: 'enum', enum: ['OFFICE', 'DATACENTER'] })
  kind!: 'OFFICE' | 'DATACENTER';

  @Column({ name: 'token_hash', type: 'char', length: 64, nullable: true })
  tokenHash!: string | null;

  @Column({ name: 'token_created_at', type: 'datetime', precision: 3, nullable: true })
  tokenCreatedAt!: Date | null;

  @Column({ name: 'last_seen_at', type: 'datetime', precision: 3, nullable: true })
  lastSeenAt!: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  version!: string | null;

  @Column({ name: 'clock_skew_ms', type: 'int', nullable: true })
  clockSkewMs!: number | null;
}
