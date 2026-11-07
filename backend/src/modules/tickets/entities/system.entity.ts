import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Un producto del catálogo: lo que la casa arrienda. Una fila por producto,
 * para todos los clientes (migración 029).
 *
 * A cada cliente se le **asigna** desde `client_systems`, que guarda la
 * pareja cliente-producto. El nombre vive aquí y solo aquí: escrito una vez, no
 * una vez por cliente.
 *
 * `isActive` dice si la casa **lo sigue ofreciendo**. Un producto retirado deja
 * de poder asignarse a clientes nuevos, pero las asignaciones que ya existen
 * no se tocan y siguen siendo elegibles en el formulario de ticket.
 */
@Entity('systems')
export class System {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
