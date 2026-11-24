import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FixedWindowLimiter } from '../../common/rate-limit/fixed-window-limiter';
import { TicketMessagesModule } from '../ticket-messages/ticket-messages.module';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkItemsModule } from '../work-items/work-items.module';
import { DevAdminController } from './dev-admin.controller';
import { DevApiController } from './dev-api.controller';
import { DevApiService } from './dev-api.service';
import { DevConnectorRepository } from './dev-connector.repository';
import { DevKeyGuard, DevRateLimiter } from './dev-key.guard';
import { DevKeysService } from './dev-keys.service';
import { DevReposService } from './dev-repos.service';
import { DevKey } from './entities/dev-key.entity';
import { DevLink } from './entities/dev-link.entity';
import { DevRepo } from './entities/dev-repo.entity';

/** Conector de tickets para Claude. Spec: 2026-11-24-conector-tickets-claude-design.md. */
@Module({
  imports: [
    TypeOrmModule.forFeature([DevRepo, DevKey, DevLink]),
    TicketsModule,
    TicketMessagesModule,
    WorkItemsModule,
  ],
  controllers: [DevAdminController, DevApiController],
  providers: [
    DevConnectorRepository,
    DevKeysService,
    DevReposService,
    DevApiService,
    DevKeyGuard,
    // Estado en memoria del proceso: un solo limitador para todas las peticiones.
    { provide: FixedWindowLimiter, useClass: DevRateLimiter },
  ],
})
export class DevConnectorModule {}
