import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientSystem } from './entities/client-system.entity';

/**
 * Una asignación con el nombre que le da el catálogo.
 *
 * **`id` es el de la asignación, y es lo que el ticket guarda en
 * `tickets.system_id`** (decisión 2 del diseño: no se repunta nada). `systemId`
 * es el producto del catálogo, para quien quiera agrupar por producto.
 */
export interface ClientSystemView {
  id: number;
  clientId: number;
  systemId: number;
  name: string;
  isActive: number;
}

/** Fila cruda de `getRawMany`: los `bigint` llegan como cadena. */
interface RawClientSystemRow {
  id: string | number;
  clientId: string | number;
  systemId: string | number;
  name: string;
  isActive: string | number;
}

@Injectable()
export class ClientSystemsRepository {
  constructor(@InjectRepository(ClientSystem) private readonly repo: Repository<ClientSystem>) {}

  /**
   * Las asignaciones del cliente con el nombre del catálogo, activas o no.
   *
   * El `INNER JOIN` es lo que deja fuera las filas que la migración 029 marcó
   * (sin `system_id`, sin nombre de catálogo que enseñar), sin ninguna
   * condición extra que haya que acordarse de escribir en cada consulta.
   */
  listByClient(clientId: number): Promise<ClientSystemView[]> {
    return this.listJoined(clientId, false);
  }

  /** Lo mismo, solo las activas: es la lista entre la que se elige en un ticket. */
  listActiveByClient(clientId: number): Promise<ClientSystemView[]> {
    return this.listJoined(clientId, true);
  }

  private async listJoined(clientId: number, onlyActive: boolean): Promise<ClientSystemView[]> {
    const qb = this.repo
      .createQueryBuilder('cs')
      .innerJoin('systems', 's', 's.id = cs.system_id')
      .select('cs.id', 'id')
      .addSelect('cs.client_id', 'clientId')
      .addSelect('cs.system_id', 'systemId')
      .addSelect('s.name', 'name')
      .addSelect('cs.is_active', 'isActive')
      .where('cs.client_id = :clientId', { clientId });
    if (onlyActive) qb.andWhere('cs.is_active = 1');
    const rows: RawClientSystemRow[] = await qb.orderBy('s.name', 'ASC').getRawMany();
    return rows.map((r) => ({
      id: Number(r.id),
      clientId: Number(r.clientId),
      systemId: Number(r.systemId),
      name: r.name,
      isActive: Number(r.isActive),
    }));
  }

  /**
   * Cuántas asignaciones apuntan a un producto del catálogo. **Cuenta las
   * activas y las inactivas**: un producto con historia no se borra, se retira
   * (decisión 3 del diseño).
   */
  countBySystem(systemId: number): Promise<number> {
    return this.repo.count({ where: { systemId } });
  }

  findById(id: number): Promise<ClientSystem | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByClientAndSystem(clientId: number, systemId: number): Promise<ClientSystem | null> {
    return this.repo.findOne({ where: { clientId, systemId } });
  }

  create(data: Partial<ClientSystem>): Promise<ClientSystem> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<ClientSystem>): Promise<ClientSystem | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
