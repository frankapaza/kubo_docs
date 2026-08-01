import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkItemEvent } from './entities/work-item-event.entity';

@Injectable()
export class WorkItemEventsRepository {
  constructor(@InjectRepository(WorkItemEvent) private readonly repo: Repository<WorkItemEvent>) {}

  append(data: Partial<WorkItemEvent>): Promise<WorkItemEvent> {
    return this.repo.save(this.repo.create(data));
  }

  listByItem(workItemId: number): Promise<WorkItemEvent[]> {
    return this.repo.find({ where: { workItemId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }
}
