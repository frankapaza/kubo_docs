import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Acta } from './entities/acta.entity';
import { ActaSignature } from './entities/acta-signature.entity';
import { Participant } from '../participants/entities/participant.entity';
import { Meeting } from '../meetings/entities/meeting.entity';
import { EmailModule } from '../email/email.module';
import { ActasService } from './actas.service';
import { ActasController } from './actas.controller';
import { ActaSignPublicController } from './acta-sign-public.controller';
import { ActaAnnexesController } from './acta-annexes.controller';
import { ActaAnnex } from './entities/acta-annex.entity';
import { ActaAnnexesService } from './services/acta-annexes.service';
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
    TypeOrmModule.forFeature([Acta, ActaSignature, ActaAnnex, Participant, Meeting]),
    MeetingsModule,
    ParticipantsModule,
    AgendaModule,
    TranscriptionsModule,
    AudioModule,
    ProjectsModule,
    AIModule,
    IntegrationsModule,
    WorkspaceModule,
    EmailModule,
  ],
  providers: [ActasService, ActaTemplateService, PdfRendererService, ActaSignaturesService, ActaAnnexesService],
  controllers: [ActasController, ActaSignPublicController, ActaAnnexesController],
  exports: [ActasService],
})
export class ActasModule {}
