import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientSystem } from './entities/client-system.entity';

@Injectable()
export class ClientSystemsRepository {
  constructor(@InjectRepository(ClientSystem) private readonly repo: Repository<ClientSystem>) {}

  listByClient(clientId: number): Promise<ClientSystem[]> {
    return this.repo.find({ where: { clientId }, order: { name: 'ASC' } });
  }

  findById(id: number): Promise<ClientSystem | null> {
    return this.repo.findOne({ where: { id } });
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
