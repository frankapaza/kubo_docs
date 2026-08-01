import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { WorkItemsRepository } from './work-items.repository';
import { WorkItemEventsRepository } from './work-item-events.repository';
import { WorkItemEventsService } from './work-item-events.service';
import { WorkItemsService } from './work-items.service';
import { ClientsModule } from '../clients/clients.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([WorkItem, WorkItemEvent]), ClientsModule, ProjectsModule],
  providers: [WorkItemsRepository, WorkItemEventsRepository, WorkItemEventsService, WorkItemsService],
  exports: [WorkItemsRepository, WorkItemEventsRepository, WorkItemEventsService, WorkItemsService],
})
export class WorkItemsModule {}
