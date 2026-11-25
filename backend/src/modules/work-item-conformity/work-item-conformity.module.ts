import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClientsModule } from '../clients/clients.module';
import { DocumentSignatoriesModule } from '../document-signatories/document-signatories.module';
import { DocumentsModule } from '../documents/documents.module';
import { CommercialDocument } from '../documents/entities/commercial-document.entity';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { WorkItemsModule } from '../work-items/work-items.module';
import { WorkItemConformityController } from './work-item-conformity.controller';
import { WorkItemConformityService } from './work-item-conformity.service';

/**
 * Acta de conformidad de un requerimiento. Módulo aparte para no crear un ciclo:
 * usa requerimientos, documentos y firmantes, y ninguno de ellos lo conoce
 * (la firma le llega por `DocumentSignatoriesService.signed$`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WorkItem, CommercialDocument]),
    ClientsModule,
    WorkItemsModule,
    DocumentsModule,
    DocumentSignatoriesModule,
  ],
  controllers: [WorkItemConformityController],
  providers: [WorkItemConformityService],
})
export class WorkItemConformityModule {}
