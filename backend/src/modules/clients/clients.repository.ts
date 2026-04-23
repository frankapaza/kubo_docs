import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Client, ClientStatus } from './entities/client.entity';

@Injectable()
export class ClientsRepository {
  constructor(@InjectRepository(Client) private readonly repo: Repository<Client>) {}

  async list(params: { status?: ClientStatus; q?: string }): Promise<Client[]> {
    const where: Record<string, unknown> = {};
    if (params.status) where.status = params.status;
    if (params.q) where.razonSocial = Like(`%${params.q}%`);
    return this.repo.find({ where, order: { razonSocial: 'ASC' } });
  }

  findById(id: number): Promise<Client | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByRuc(ruc: string): Promise<Client | null> {
    return this.repo.findOne({ where: { ruc } });
  }

  create(data: Partial<Client>): Promise<Client> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<Client>): Promise<Client | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
