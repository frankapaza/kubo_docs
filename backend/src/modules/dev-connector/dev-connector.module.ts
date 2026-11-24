import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FixedWindowLimiter } from '../../common/rate-limit/fixed-window-limiter';
import { TicketsModule } from '../tickets/tickets.module';
import { DevAdminController } from './dev-admin.controller';
import { DevConnectorRepository } from './dev-connector.repository';
import { DevKeyGuard, DevRateLimiter } from './dev-key.guard';
import { DevKeysService } from './dev-keys.service';
import { DevReposService } from './dev-repos.service';
import { DevKey } from './entities/dev-key.entity';
import { DevLink } from './entities/dev-link.entity';
import { DevRepo } from './entities/dev-repo.entity';

/** Conector de tickets para Claude. Spec: 2026-11-24-conector-tickets-claude-design.md. */
@Module({
  imports: [TypeOrmModule.forFeature([DevRepo, DevKey, DevLink]), TicketsModule],
  controllers: [DevAdminController],
  providers: [
    DevConnectorRepository,
    DevKeysService,
    DevReposService,
    DevKeyGuard,
    // Estado en memoria del proceso: un solo limitador para todas las peticiones.
    { provide: FixedWindowLimiter, useClass: DevRateLimiter },
  ],
})
export class DevConnectorModule {}
