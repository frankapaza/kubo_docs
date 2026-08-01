import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { WorkItemsRepository } from './work-items.repository';
import { WorkItemEventsRepository } from './work-item-events.repository';
import { WorkItemEventsService } from './work-item-events.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkItem, WorkItemEvent])],
  providers: [WorkItemsRepository, WorkItemEventsRepository, WorkItemEventsService],
  exports: [WorkItemsRepository, WorkItemEventsRepository, WorkItemEventsService],
})
export class WorkItemsModule {}
