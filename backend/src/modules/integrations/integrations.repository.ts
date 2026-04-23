import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Integration } from './entities/integration.entity';

@Injectable()
export class IntegrationsRepository {
  constructor(
    @InjectRepository(Integration) private readonly repo: Repository<Integration>,
  ) {}

  findAll(): Promise<Integration[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  findById(id: number): Promise<Integration | null> {
    return this.repo.findOne({ where: { id } });
  }

  create(data: Partial<Integration>): Promise<Integration> {
    return this.repo.save(this.repo.create(data));
  }

  save(i: Integration): Promise<Integration> {
    return this.repo.save(i);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
