import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportAgent } from './entities/support-agent.entity';

@Injectable()
export class SupportAgentsRepository {
  constructor(@InjectRepository(SupportAgent) private readonly repo: Repository<SupportAgent>) {}

  list(): Promise<SupportAgent[]> {
    return this.repo.find({ order: { level: 'ASC', id: 'ASC' } });
  }

  listActive(): Promise<SupportAgent[]> {
    return this.repo.find({ where: { isActive: 1 } });
  }

  findById(id: number): Promise<SupportAgent | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByUserId(userId: number): Promise<SupportAgent | null> {
    return this.repo.findOne({ where: { userId } });
  }

  create(data: Partial<SupportAgent>): Promise<SupportAgent> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<SupportAgent>): Promise<SupportAgent | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
