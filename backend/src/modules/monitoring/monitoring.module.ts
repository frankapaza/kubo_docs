import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClientsModule } from '../clients/clients.module';
import { TicketsModule } from '../tickets/tickets.module';
import { LogInstallation } from './entities/log-installation.entity';
import { LogInstallationSource } from './entities/log-installation-source.entity';
import { InstallationsController } from './installations.controller';
import { InstallationsRepository } from './installations.repository';
import { InstallationsService } from './installations.service';
import { LokiClient } from './loki/loki.client';

@Module({
  imports: [TypeOrmModule.forFeature([LogInstallation, LogInstallationSource]), TicketsModule, ClientsModule],
  providers: [InstallationsRepository, InstallationsService, LokiClient],
  controllers: [InstallationsController],
  // LokiClient y el servicio de instalaciones los usarán la ingesta, el
  // registro de errores y la lectura de logs de las tareas siguientes.
  exports: [InstallationsService, LokiClient],
})
export class MonitoringModule {}
