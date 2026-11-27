import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Client } from '../clients/entities/client.entity';
import { PortalModule } from '../portal/portal.module';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { WorkItemsModule } from '../work-items/work-items.module';
import { ApiClientRateLimiter, ApiKeyGuard, ApiKeyRateLimiter } from './api-key.guard';
import { PortalApiKeysController, StaffApiKeysController } from './api-keys.controllers';
import { ApiKeysService } from './api-keys.service';
import { ClientApiKey } from './entities/client-api-key.entity';
import { IntegrationController } from './integration.controller';
import { IntegrationQueryService } from './integration-query.service';

/** API de integración para clientes. Spec: 2026-11-27-api-integracion-clientes-design.md. */
@Module({
  imports: [
    TypeOrmModule.forFeature([ClientApiKey, Client, Ticket, WorkItem]),
    // La frontera de visibilidad es la del portal: se reutilizan sus servicios.
    PortalModule,
    TicketsModule,
    WorkItemsModule,
  ],
  controllers: [PortalApiKeysController, StaffApiKeysController, IntegrationController],
  providers: [
    ApiKeysService,
    ApiKeyGuard,
    IntegrationQueryService,
    // Estado en memoria del proceso: un limitador por clave y otro por cliente.
    ApiKeyRateLimiter,
    ApiClientRateLimiter,
  ],
})
export class IntegrationApiModule {}
