import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSignatory } from './entities/document-signatory.entity';
import { CommercialDocument } from '../documents/entities/commercial-document.entity';
import { DocumentSignatoriesRepository } from './document-signatories.repository';
import { DocumentSignatoriesService } from './document-signatories.service';
import { DocumentSignatoriesController } from './document-signatories.controller';
import { EmailModule } from '../email/email.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentSignatory, CommercialDocument]),
    EmailModule,
    WorkspaceModule,
  ],
  providers: [DocumentSignatoriesRepository, DocumentSignatoriesService],
  controllers: [DocumentSignatoriesController],
  exports: [DocumentSignatoriesService],
})
export class DocumentSignatoriesModule {}
