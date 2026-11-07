import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isForeignKeyRestrict } from '../../common/db-errors';

import { ClientSystemsRepository, ClientSystemView } from './client-systems.repository';
import { SystemsRepository } from './systems.repository';
import { TicketsRepository } from './tickets.repository';
import { ClientsService } from '../clients/clients.service';
import { ClientSystem } from './entities/client-system.entity';
import { AssignClientSystemDto, UpdateClientSystemDto } from './dto/client-system.dto';

/**
 * Los sistemas asignados a un cliente: qué productos del catálogo le arrienda
 * la casa.
 *
 * Desactivar y quitar son dos gestos distintos:
 *
 * - **Desactivar** («este cliente dejó de usarlo») no toca ningún ticket: deja
 *   de poder elegirse en el formulario y se sigue viendo, con la marca
 *   «(inactivo)», en los tickets que ya lo apuntan. Es el gesto normal.
 * - **Quitar** borra la fila, y solo se permite si ningún ticket la apunta: la
 *   asignación que alguien puso por error hace cinco minutos. Con tickets
 *   detrás, borrarla dejaría `tickets.system_id` apuntando a una fila que ya no
 *   existe, y el informe por sistema leería un id que no resuelve a nada.
 */
@Injectable()
export class ClientSystemsService {
  constructor(
    private readonly repo: ClientSystemsRepository,
    private readonly clients: ClientsService,
    private readonly systems: SystemsRepository,
    private readonly tickets: TicketsRepository,
  ) {}

  async listByClient(clientId: number): Promise<ClientSystemView[]> {
    await this.clients.findByIdOrFail(clientId);
    return this.repo.listByClient(clientId);
  }

  async create(clientId: number, dto: AssignClientSystemDto): Promise<ClientSystem> {
    await this.clients.findByIdOrFail(clientId);

    const system = await this.systems.findById(dto.systemId);
    if (!system) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sistema no encontrado' });
    }
    // Retirado del catálogo = la casa ya no lo ofrece a nadie más. Los clientes
    // que ya lo tienen lo conservan; este no lo recibe.
    if (!system.isActive) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Este sistema está retirado del catálogo y ya no se puede asignar.',
      });
    }
    if (await this.repo.findByClientAndSystem(clientId, dto.systemId)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Este cliente ya tiene asignado «${system.name}».`,
      });
    }
    return this.repo.create({ clientId, systemId: dto.systemId, isActive: 1 });
  }

  async update(id: number, dto: UpdateClientSystemDto): Promise<ClientSystem> {
    await this.findByIdOrFail(id);
    const patch: Partial<ClientSystem> = {};
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;
    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    await this.findByIdOrFail(id);
    // Por el id de la asignación: es lo que el ticket guarda en `system_id`.
    if ((await this.tickets.countByClientSystem(id)) > 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Este cliente tiene tickets de este sistema. Desactívalo en lugar de quitarlo.',
      });
    }
    try {
      await this.repo.remove(id);
    } catch (e) {
      // `log_installations` apunta aquí con FK RESTRICT (migración 030). No se
      // cuenta de antemano para que tickets no dependa de monitoreo: lo decide
      // la base y se traduce el rechazo a un 409 claro en vez de un 500.
      if (isForeignKeyRestrict(e)) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Tiene una instalación de monitoreo; revócala o bórrala primero.',
        });
      }
      throw e;
    }
  }

  private async findByIdOrFail(id: number): Promise<ClientSystem> {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sistema no encontrado' });
    }
    return current;
  }
}
