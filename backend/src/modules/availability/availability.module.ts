import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../clients/clients.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AvailabilityInventoryController } from './availability-inventory.controller';
import { AvailabilityInventoryService } from './availability-inventory.service';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';
import { IncidentCloser, NoopIncidentCloser } from './incident-closer';

@Module({
  imports: [TypeOrmModule.forFeature([MonitorServer, MonitorService, MonitorProbe]), ClientsModule, TicketsModule],
  controllers: [AvailabilityInventoryController],
  providers: [
    AvailabilityInventoryService,
    // Task 9 lo reemplaza por AvailabilityEvaluatorService
    { provide: IncidentCloser, useClass: NoopIncidentCloser },
  ],
  exports: [AvailabilityInventoryService, IncidentCloser],
})
export class AvailabilityModule {}
