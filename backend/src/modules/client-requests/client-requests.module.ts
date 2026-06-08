import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientRequest } from './entities/client-request.entity';
import { ClientRequestsRepository } from './client-requests.repository';
import { ClientRequestsService } from './client-requests.service';
import { ClientRequestsController } from './client-requests.controller';
import { ClientsModule } from '../clients/clients.module';
import { ProjectsModule } from '../projects/projects.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AIModule } from '../ai/ai.module';
import { TranscriptionsModule } from '../transcriptions/transcriptions.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClientRequest]),
    ClientsModule,
    ProjectsModule,
    IntegrationsModule,
    AIModule,
    TranscriptionsModule,
    DocumentsModule,
  ],
  providers: [ClientRequestsRepository, ClientRequestsService],
  controllers: [ClientRequestsController],
  exports: [ClientRequestsRepository],
})
export class ClientRequestsModule {}
