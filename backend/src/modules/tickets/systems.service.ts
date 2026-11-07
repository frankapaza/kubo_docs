import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isForeignKeyRestrict } from '../../common/db-errors';

import { sameId } from '../../common/ids';
import { SystemsRepository } from './systems.repository';
import { ClientSystemsRepository } from './client-systems.repository';
import { System } from './entities/system.entity';
import { CreateSystemDto, UpdateSystemDto } from './dto/system.dto';

/**
 * El catálogo de sistemas: los productos que la casa arrienda, uno por fila y
 * para todos los clientes.
 *
 * Retirar (`isActive = 0`) y borrar son dos gestos distintos, y ninguno toca
 * histórico:
 *
 * - **Retirar** deja de ofrecerlo a clientes nuevos. Las asignaciones que ya
 *   existen no se miran ni se tocan: si tres clientes lo siguen arrendando,
 *   siguen abriendo tickets sobre él.
 * - **Borrar** solo se permite si nadie lo tiene asignado, ni activo ni
 *   inactivo. Un producto con historia no se borra, se retira.
 */
@Injectable()
export class SystemsService {
  constructor(
    private readonly repo: SystemsRepository,
    private readonly assignments: ClientSystemsRepository,
  ) {}

  list(): Promise<System[]> {
    return this.repo.list();
  }

  async create(dto: CreateSystemDto): Promise<System> {
    const name = dto.name.trim();
    await this.assertNameFree(name, null);
    return this.repo.create({ name, isActive: 1 });
  }

  async update(id: number, dto: UpdateSystemDto): Promise<System> {
    await this.findByIdOrFail(id);

    const patch: Partial<System> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      await this.assertNameFree(name, id);
      patch.name = name;
    }
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;

    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    await this.findByIdOrFail(id);
    if ((await this.assignments.countBySystem(id)) > 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message:
          'Este sistema está asignado a algún cliente. Retíralo del catálogo en lugar de borrarlo.',
      });
    }
    try {
      await this.repo.remove(id);
    } catch (e) {
      // Una instalación INTERNA puede apuntar al producto sin ninguna
      // asignación de por medio (FK RESTRICT, migración 030), así que el
      // conteo de arriba no la ve. Lo decide la base; se traduce a 409.
      if (isForeignKeyRestrict(e)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Tiene una instalación de monitoreo; revócala o bórrala primero.',
        });
      }
      throw e;
    }
  }

  private async findByIdOrFail(id: number): Promise<System> {
    const system = await this.repo.findById(id);
    if (!system) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sistema no encontrado' });
    }
    return system;
  }

  /**
   * Un nombre solo puede tenerlo un producto. La búsqueda ya ignora mayúsculas
   * (la colación de la tabla); renombrarse a sí mismo --aunque sea cambiando
   * solo mayúsculas-- no es un duplicado. Por `sameId` y no por `===`: el id
   * que devuelve la base es una cadena.
   */
  private async assertNameFree(name: string, selfId: number | null): Promise<void> {
    const existing = await this.repo.findByName(name);
    if (existing && !sameId(existing.id, selfId)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Ya existe un sistema llamado «${name}» en el catálogo.`,
      });
    }
  }
}
