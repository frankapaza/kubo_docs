import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AIProvider } from './entities/ai-provider.entity';

@Injectable()
export class AIProvidersRepository {
  constructor(
    @InjectRepository(AIProvider) private readonly repo: Repository<AIProvider>,
  ) {}

  findAll(): Promise<AIProvider[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  findById(id: number): Promise<AIProvider | null> {
    return this.repo.findOne({ where: { id } });
  }

  findActive(): Promise<AIProvider | null> {
    return this.repo.findOne({ where: { isActive: 1 } });
  }

  create(data: Partial<AIProvider>): Promise<AIProvider> {
    return this.repo.save(this.repo.create(data));
  }

  save(p: AIProvider): Promise<AIProvider> {
    return this.repo.save(p);
  }

  async deactivateAll(): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ isActive: 0 })
      .where('1 = 1')
      .execute();
  }

  async setActive(id: number): Promise<void> {
    await this.repo.update(id, { isActive: 1 });
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
