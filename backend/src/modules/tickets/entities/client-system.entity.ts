import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * La asignación de un producto del catálogo (`systems`) a un cliente: qué le
 * arrienda la casa a quién. Desde la migración 029 esta tabla dejó de ser el
 * catálogo y pasó a ser la pareja cliente-producto.
 *
 * **`id` es lo que el ticket guarda en `tickets.system_id`**, y sigue siéndolo:
 * el ticket es sobre la instalación que tiene esta empresa, no sobre el
 * producto en abstracto. Del ticket se llega al producto por `systemId`.
 *
 * `systemId` vacío es una fila que la migración marcó como dudosa (ver
 * `system_catalog_conflicts`): no tiene nombre de catálogo que enseñar, no sale
 * en ninguna lista y no hace que se exija nada.
 *
 * `name` se conserva --no se borra-- como la única constancia de qué decía una
 * fila marcada y de qué nombre dio origen a cada producto. Las asignaciones
 * nuevas lo dejan vacío: el nombre vive en el catálogo.
 *
 * `isActive` es de la relación, no del producto: que esta empresa deje de usar
 * un sistema no dice nada de las demás que lo tienen.
 */
@Entity('client_systems')
@Index('idx_client_systems_client', ['clientId'])
export class ClientSystem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  @Column({ name: 'system_id', type: 'bigint', unsigned: true, nullable: true })
  systemId!: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
