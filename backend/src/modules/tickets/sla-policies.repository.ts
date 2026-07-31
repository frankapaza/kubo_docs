import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SlaPolicy } from './entities/sla-policy.entity';

@Injectable()
export class SlaPoliciesRepository {
  constructor(@InjectRepository(SlaPolicy) private readonly repo: Repository<SlaPolicy>) {}

  list(): Promise<SlaPolicy[]> {
    return this.repo.find({ order: { isDefault: 'DESC', name: 'ASC' } });
  }

  findById(id: number): Promise<SlaPolicy | null> {
    return this.repo.findOne({ where: { id } });
  }

  findDefault(): Promise<SlaPolicy | null> {
    return this.repo.findOne({ where: { isDefault: 1 } });
  }

  async update(id: number, data: Partial<SlaPolicy>): Promise<SlaPolicy | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }
}
