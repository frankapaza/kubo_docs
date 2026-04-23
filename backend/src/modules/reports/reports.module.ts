import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ProjectsModule } from '../projects/projects.module';
import { ClientsModule } from '../clients/clients.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AIModule } from '../ai/ai.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    ProjectsModule,
    ClientsModule,
    IntegrationsModule,
    AIModule,
    DocumentsModule,
  ],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
