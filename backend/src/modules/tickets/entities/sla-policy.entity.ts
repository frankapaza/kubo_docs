import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SlaMatrix } from '../domain/sla.calculator';

@Entity('sla_policies')
export class SlaPolicy {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'is_default', type: 'tinyint', default: 0 })
  isDefault!: number;

  @Column({ name: 'p1_response_minutes', type: 'int', unsigned: true })
  p1ResponseMinutes!: number;

  @Column({ name: 'p1_resolution_minutes', type: 'int', unsigned: true })
  p1ResolutionMinutes!: number;

  @Column({ name: 'p2_response_minutes', type: 'int', unsigned: true })
  p2ResponseMinutes!: number;

  @Column({ name: 'p2_resolution_minutes', type: 'int', unsigned: true })
  p2ResolutionMinutes!: number;

  @Column({ name: 'p3_response_minutes', type: 'int', unsigned: true })
  p3ResponseMinutes!: number;

  @Column({ name: 'p3_resolution_minutes', type: 'int', unsigned: true })
  p3ResolutionMinutes!: number;

  @Column({ name: 'p4_response_minutes', type: 'int', unsigned: true })
  p4ResponseMinutes!: number;

  @Column({ name: 'p4_resolution_minutes', type: 'int', unsigned: true })
  p4ResolutionMinutes!: number;

  /** Reservado para el horario de cobertura. En T1 no se lee. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  coverage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

/** Convierte la fila de BD en la matriz que consume `sla.calculator`. */
export function toSlaMatrix(policy: SlaPolicy): SlaMatrix {
  return {
    P1: { responseMinutes: policy.p1ResponseMinutes, resolutionMinutes: policy.p1ResolutionMinutes },
    P2: { responseMinutes: policy.p2ResponseMinutes, resolutionMinutes: policy.p2ResolutionMinutes },
    P3: { responseMinutes: policy.p3ResponseMinutes, resolutionMinutes: policy.p3ResolutionMinutes },
    P4: { responseMinutes: policy.p4ResponseMinutes, resolutionMinutes: policy.p4ResolutionMinutes },
  };
}
