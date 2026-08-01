import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { WorkItemsRepository } from './work-items.repository';
import { WorkItemEventsRepository } from './work-item-events.repository';
import { WorkItemEventsService } from './work-item-events.service';
import { WorkItemsService } from './work-items.service';
import { WorkItemBoardService } from './work-item-board.service';
import { WorkItemsController } from './work-items.controller';
import { ClientsModule } from '../clients/clients.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([WorkItem, WorkItemEvent]), ClientsModule, ProjectsModule],
  controllers: [WorkItemsController],
  providers: [
    WorkItemsRepository,
    WorkItemEventsRepository,
    WorkItemEventsService,
    WorkItemsService,
    WorkItemBoardService,
  ],
  exports: [
    WorkItemsRepository,
    WorkItemEventsRepository,
    WorkItemEventsService,
    WorkItemsService,
    WorkItemBoardService,
  ],
})
export class WorkItemsModule {}
