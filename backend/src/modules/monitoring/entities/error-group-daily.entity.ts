import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Conteo por grupo y día de Perú. Sobrevive a la poda de muestras: es lo que
 * alimenta la gráfica de tendencia sin contar ocurrencias.
 *
 * `day` es `string` (`YYYY-MM-DD`): el driver devuelve DATE como cadena
 * (`dateStrings: ['DATE']`) para que no se corra un día con la zona.
 */
@Entity('error_group_daily')
export class ErrorGroupDaily {
  @PrimaryColumn({ name: 'group_id', type: 'bigint', unsigned: true })
  groupId!: number;

  @PrimaryColumn({ type: 'date' })
  day!: string;

  @Column({ type: 'int', unsigned: true })
  count!: number;
}
