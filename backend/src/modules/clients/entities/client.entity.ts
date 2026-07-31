import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ClientStatus = 'PROSPECT' | 'CLIENT' | 'FORMER_CLIENT';

export const CLIENT_STATUSES: ClientStatus[] = ['PROSPECT', 'CLIENT', 'FORMER_CLIENT'];

@Entity('clients')
@Index('idx_clients_status', ['status'])
@Index('idx_clients_ruc', ['ruc'])
export class Client {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'razon_social', type: 'varchar', length: 200 })
  razonSocial!: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  ruc!: string | null;

  @Column({ name: 'jira_code', type: 'varchar', length: 10, nullable: true })
  jiraCode!: string | null;

  @Column({ name: 'sla_policy_id', type: 'bigint', unsigned: true, nullable: true })
  slaPolicyId!: number | null;

  @Column({ name: 'legal_rep_name', type: 'varchar', length: 180, nullable: true })
  legalRepName!: string | null;

  @Column({ name: 'legal_rep_doc', type: 'varchar', length: 20, nullable: true })
  legalRepDoc!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ name: 'contact_email', type: 'varchar', length: 180, nullable: true })
  contactEmail!: string | null;

  @Column({ type: 'enum', enum: CLIENT_STATUSES, default: 'PROSPECT' })
  status!: ClientStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
