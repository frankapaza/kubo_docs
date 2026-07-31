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

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, TicketEvent, SlaPolicy, SupportAgent, ClientSystem]),
  ],
  providers: [
    TicketsRepository,
    TicketEventsRepository,
    SlaPoliciesRepository,
    SupportAgentsRepository,
    ClientSystemsRepository,
  ],
  exports: [
    TicketsRepository,
    TicketEventsRepository,
    SlaPoliciesRepository,
    SupportAgentsRepository,
    ClientSystemsRepository,
  ],
})
export class TicketsModule {}
