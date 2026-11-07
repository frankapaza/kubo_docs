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
import { InstallationsController } from './installations.controller';
import { InstallationsRepository } from './installations.repository';
import { InstallationsService } from './installations.service';
import { LokiClient } from './loki/loki.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([LogInstallation, LogInstallationSource, ErrorGroup, ErrorOccurrence, ErrorGroupDaily]),
    TicketsModule,
    ClientsModule,
  ],
  providers: [InstallationsRepository, InstallationsService, LokiClient, ErrorGroupsRepository, ErrorGroupsService, ErrorActionsService],
  controllers: [InstallationsController, ErrorsController],
  // LokiClient, el servicio de instalaciones y el de grupos de error los
  // usarán la ingesta (que registra las ocurrencias) y la lectura de logs.
  exports: [InstallationsService, LokiClient, ErrorGroupsService],
})
export class MonitoringModule {}
