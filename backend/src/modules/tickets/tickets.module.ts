import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { SlaPolicy } from './entities/sla-policy.entity';
import { SupportAgent } from './entities/support-agent.entity';
import { ClientSystem } from './entities/client-system.entity';

import { TicketsRepository } from './tickets.repository';
import { TicketEventsRepository } from './ticket-events.repository';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { SupportAgentsRepository } from './support-agents.repository';
import { ClientSystemsRepository } from './client-systems.repository';
import { TicketEventsService } from './ticket-events.service';
import { SlaService } from './sla.service';
import { TicketsService } from './tickets.service';
import { TicketTransitionsService } from './ticket-transitions.service';
import { TicketAssignmentService } from './ticket-assignment.service';
import { TicketAIService } from './ticket-ai.service';
import { ClientSystemsService } from './client-systems.service';
import { SupportAgentsService } from './support-agents.service';
import { SlaRiskScheduler } from './sla-risk.scheduler';
import { TicketsController } from './tickets.controller';
import { ClientSystemsController } from './client-systems.controller';
import { SupportAgentsController } from './support-agents.controller';
import { ClientsModule } from '../clients/clients.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AIModule } from '../ai/ai.module';
import { TranscriptionsModule } from '../transcriptions/transcriptions.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, TicketEvent, SlaPolicy, SupportAgent, ClientSystem]),
    ClientsModule,
    ProjectsModule,
    UsersModule,
    IntegrationsModule,
    AIModule,
    TranscriptionsModule,
    DocumentsModule,
  ],
  providers: [
    TicketsRepository,
    TicketEventsRepository,
    SlaPoliciesRepository,
    SupportAgentsRepository,
    ClientSystemsRepository,
    TicketEventsService,
    SlaService,
    TicketsService,
    TicketTransitionsService,
    TicketAssignmentService,
    TicketAIService,
    ClientSystemsService,
    SupportAgentsService,
    SlaRiskScheduler,
  ],
  controllers: [TicketsController, ClientSystemsController, SupportAgentsController],
  exports: [
    TicketsRepository,
    TicketEventsRepository,
    SlaPoliciesRepository,
    SupportAgentsRepository,
    ClientSystemsRepository,
    TicketEventsService,
    SlaService,
    TicketsService,
    TicketTransitionsService,
    TicketAssignmentService,
    ClientSystemsService,
    SupportAgentsService,
  ],
})
export class TicketsModule {}
