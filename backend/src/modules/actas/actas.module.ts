import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Acta } from './entities/acta.entity';
import { ActaSignature } from './entities/acta-signature.entity';
import { Participant } from '../participants/entities/participant.entity';
import { ActasService } from './actas.service';
import { ActasController } from './actas.controller';
import { ActaTemplateService } from './services/acta-template.service';
import { PdfRendererService } from './services/pdf-renderer.service';
import { ActaSignaturesService } from './services/acta-signatures.service';
import { MeetingsModule } from '../meetings/meetings.module';
import { ParticipantsModule } from '../participants/participants.module';
import { AgendaModule } from '../agenda/agenda.module';
import { TranscriptionsModule } from '../transcriptions/transcriptions.module';
import { AudioModule } from '../audio/audio.module';
import { ProjectsModule } from '../projects/projects.module';
import { AIModule } from '../ai/ai.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Acta, ActaSignature, Participant]),
    MeetingsModule,
    ParticipantsModule,
    AgendaModule,
    TranscriptionsModule,
    AudioModule,
    ProjectsModule,
    AIModule,
    IntegrationsModule,
    WorkspaceModule,
  ],
  providers: [ActasService, ActaTemplateService, PdfRendererService, ActaSignaturesService],
  controllers: [ActasController],
  exports: [ActasService],
})
export class ActasModule {}
