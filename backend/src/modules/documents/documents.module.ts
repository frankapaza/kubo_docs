import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentTemplate } from './entities/document-template.entity';
import { CommercialDocument } from './entities/commercial-document.entity';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { TemplateRendererService } from './services/template-renderer.service';
import { DocumentPdfService } from './services/document-pdf.service';
import { ClientsModule } from '../clients/clients.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { EmailModule } from '../email/email.module';
import { DocumentSignatoriesModule } from '../document-signatories/document-signatories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentTemplate, CommercialDocument]),
    ClientsModule,
    WorkspaceModule,
    EmailModule,
    DocumentSignatoriesModule,
  ],
  providers: [
    DocumentsRepository,
    DocumentsService,
    TemplateRendererService,
    DocumentPdfService,
  ],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
