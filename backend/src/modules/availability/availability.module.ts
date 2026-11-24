import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../clients/clients.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AvailabilityIngestController } from './availability-ingest.controller';
import { AvailabilityIngestService } from './availability-ingest.service';
import { AvailabilityInventoryController } from './availability-inventory.controller';
import { AvailabilityInventoryService } from './availability-inventory.service';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorProbeOrder } from './entities/monitor-probe-order.entity';
import { MonitorProbeSignal } from './entities/monitor-probe-signal.entity';
import { MonitorProbeState } from './entities/monitor-probe-state.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';
import { IncidentCloser, NoopIncidentCloser } from './incident-closer';
import { ProbeRateLimiter } from './probe-rate-limiter';
import { ProbeTokenGuard } from './probe-token.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MonitorServer,
      MonitorService,
      MonitorProbe,
      MonitorCheck,
      MonitorProbeSignal,
      MonitorProbeOrder,
      MonitorProbeState,
      MonitorIncident,
    ]),
    ClientsModule,
    TicketsModule,
  ],
  controllers: [AvailabilityInventoryController, AvailabilityIngestController],
  providers: [
    AvailabilityInventoryService,
    AvailabilityIngestService,
    ProbeTokenGuard,
    ProbeRateLimiter,
    // Task 9 lo reemplaza por AvailabilityEvaluatorService
    { provide: IncidentCloser, useClass: NoopIncidentCloser },
  ],
  exports: [AvailabilityInventoryService, AvailabilityIngestService, IncidentCloser],
})
export class AvailabilityModule {}
