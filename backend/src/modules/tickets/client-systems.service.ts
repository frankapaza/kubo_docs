import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ClientSystemsRepository } from './client-systems.repository';
import { ClientsService } from '../clients/clients.service';
import { ClientSystem } from './entities/client-system.entity';
import { CreateClientSystemDto, UpdateClientSystemDto } from './dto/client-system.dto';

@Injectable()
export class ClientSystemsService {
  constructor(
    private readonly repo: ClientSystemsRepository,
    private readonly clients: ClientsService,
  ) {}

  async listByClient(clientId: number): Promise<ClientSystem[]> {
    await this.clients.findByIdOrFail(clientId);
    return this.repo.listByClient(clientId);
  }

  async create(clientId: number, dto: CreateClientSystemDto): Promise<ClientSystem> {
    await this.clients.findByIdOrFail(clientId);
    const name = dto.name.trim();

    const existing = await this.repo.listByClient(clientId);
    if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `El cliente ya tiene un sistema llamado «${name}».`,
      });
    }
    return this.repo.create({ clientId, name, isActive: 1 });
  }

  async update(id: number, dto: UpdateClientSystemDto): Promise<ClientSystem> {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sistema no encontrado' });
    }
    const patch: Partial<ClientSystem> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const existing = await this.repo.listByClient(current.clientId);
      if (existing.some((s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase())) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: `El cliente ya tiene un sistema llamado «${name}».`,
        });
      }
      patch.name = name;
    }
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;

    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sistema no encontrado' });
    }
    await this.repo.remove(id);
  }
}
