import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClientsModule } from '../clients/clients.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ErrorGroup } from './entities/error-group.entity';
import { ErrorGroupDaily } from './entities/error-group-daily.entity';
import { ErrorOccurrence } from './entities/error-occurrence.entity';
import { LogInstallation } from './entities/log-installation.entity';
import { LogInstallationSource } from './entities/log-installation-source.entity';
import { ErrorActionsService } from './error-actions.service';
import { ErrorGroupsRepository } from './error-groups.repository';
import { ErrorGroupsService } from './error-groups.service';
import { ErrorsController } from './errors.controller';
import { IngestController } from './ingest/ingest.controller';
import { IngestRateLimiter } from './ingest/ingest-rate-limiter';
import { IngestService } from './ingest/ingest.service';
import { InstallationKeyGuard } from './ingest/installation-key.guard';
import { RecentBatches } from './ingest/recent-batches';
import { InstallationsController } from './installations.controller';
import { InstallationsRepository } from './installations.repository';
import { InstallationsService } from './installations.service';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { LokiClient } from './loki/loki.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([LogInstallation, LogInstallationSource, ErrorGroup, ErrorOccurrence, ErrorGroupDaily]),
    TicketsModule,
    ClientsModule,
  ],
  providers: [
    InstallationsRepository,
    InstallationsService,
    LokiClient,
    LogsService,
    ErrorGroupsRepository,
    ErrorGroupsService,
    ErrorActionsService,
    // Ingesta. El limitador y los lotes recientes son estado en memoria del
    // proceso: singletons del módulo, compartidos por todas las peticiones.
    IngestService,
    InstallationKeyGuard,
    IngestRateLimiter,
    RecentBatches,
  ],
  controllers: [InstallationsController, ErrorsController, IngestController, LogsController],
  // LokiClient, el servicio de instalaciones y el de grupos de error los
  // usarán la ingesta (que registra las ocurrencias) y la lectura de logs.
  exports: [InstallationsService, LokiClient, ErrorGroupsService],
})
export class MonitoringModule {}
