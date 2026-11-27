import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemAttachment } from './entities/work-item-attachment.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { WorkItemsRepository } from './work-items.repository';
import { WorkItemEventsRepository } from './work-item-events.repository';
import { WorkItemEventsService } from './work-item-events.service';
import { WorkItemsService } from './work-items.service';
import { WorkItemBoardService } from './work-item-board.service';
import { WorkItemIntakeService } from './work-item-intake.service';
import { WorkItemDocumentsService } from './work-item-documents.service';
import { WorkItemsController } from './work-items.controller';
import { WorkItemDocumentsController } from './work-item-documents.controller';
import { ClientsModule } from '../clients/clients.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([WorkItem, WorkItemEvent, WorkItemAttachment]), ClientsModule, StorageModule],
  controllers: [WorkItemsController, WorkItemDocumentsController],
  providers: [
    WorkItemsRepository,
    WorkItemEventsRepository,
    WorkItemEventsService,
    WorkItemsService,
    WorkItemBoardService,
    WorkItemIntakeService,
    WorkItemDocumentsService,
  ],
  exports: [
    WorkItemsRepository,
    WorkItemEventsRepository,
    WorkItemEventsService,
    WorkItemsService,
    WorkItemBoardService,
    WorkItemIntakeService,
    WorkItemDocumentsService,
  ],
})
export class WorkItemsModule {}
