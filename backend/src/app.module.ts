import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { DbTimezoneInitializer } from './config/db-timezone.initializer';
import { JwtSecretsValidator } from './config/jwt-secrets.validator';
import { PortalSchemaValidator } from './config/portal-schema.validator';
import { bullOptionsFactory, typeOrmOptionsFactory } from './config/typeorm.options';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { AgendaModule } from './modules/agenda/agenda.module';
import { AudioModule } from './modules/audio/audio.module';
import { TranscriptionsModule } from './modules/transcriptions/transcriptions.module';
import { ActasModule } from './modules/actas/actas.module';
import { AgreementsModule } from './modules/agreements/agreements.module';
import { AuditModule } from './modules/audit/audit.module';
import { AIModule } from './modules/ai/ai.module';
import { AgentsModule } from './modules/agents/agents.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ClientsModule } from './modules/clients/clients.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { WorkItemsModule } from './modules/work-items/work-items.module';
import { PortalModule } from './modules/portal/portal.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { DocumentSignatoriesModule } from './modules/document-signatories/document-signatories.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { ReportsModule } from './modules/reports/reports.module';
import { EmailModule } from './modules/email/email.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TicketMessagesModule } from './modules/ticket-messages/ticket-messages.module';
import { InboundEmailModule } from './modules/inbound-email/inbound-email.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { AvailabilityModule } from './modules/availability/availability.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: typeOrmOptionsFactory,
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: bullOptionsFactory,
    }),

    AuthModule,
    UsersModule,
    ProjectsModule,
    MeetingsModule,
    ParticipantsModule,
    AgendaModule,
    AudioModule,
    TranscriptionsModule,
    ActasModule,
    AgreementsModule,
    AuditModule,
    AIModule,
    AgentsModule,
    IntegrationsModule,
    ClientsModule,
    TicketsModule,
    WorkItemsModule,
    PortalModule,
    DocumentsModule,
    DocumentSignatoriesModule,
    WorkspaceModule,
    ReportsModule,
    EmailModule,
    NotificationsModule,
    TicketMessagesModule,
    InboundEmailModule,
    MonitoringModule,
    AvailabilityModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    DbTimezoneInitializer,
    JwtSecretsValidator,
    PortalSchemaValidator,
  ],
})
export class AppModule {}
