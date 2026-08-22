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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'mysql',
        host: cfg.get<string>('DB_HOST'),
        port: parseInt(cfg.get<string>('DB_PORT', '3306'), 10),
        username: cfg.get<string>('DB_USER'),
        password: cfg.get<string>('DB_PASSWORD'),
        database: cfg.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: false,
        charset: 'utf8mb4',
        // mysql2 convierte los Date de JS usando la zona local del proceso.
        // Con 'Z' lee y escribe los DATETIME en UTC, de modo que DATETIME y
        // TIMESTAMP round-trip de forma coherente y la aritmetica de SLA cuadra.
        timezone: 'Z',
        // Una columna DATE no tiene hora ni zona. Con timezone:'Z' el driver la
        // convertía a un Date en medianoche UTC y al serializarla volvía el día
        // anterior. Devolverlas como string las deja intactas, que es lo que las
        // entidades ya declaran.
        dateStrings: ['DATE'],
        // BIGINT se convierte a number si es seguro (< 2^53); strings si es más grande.
        // Esto evita comparaciones fallidas en el frontend (t.id === selectedId).
        supportBigNumbers: true,
        bigNumberStrings: false,
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        connection: {
          host: cfg.get<string>('REDIS_HOST'),
          port: parseInt(cfg.get<string>('REDIS_PORT', '6379'), 10),
        },
      }),
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
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    DbTimezoneInitializer,
    JwtSecretsValidator,
    PortalSchemaValidator,
  ],
})
export class AppModule {}
