import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../clients/clients.module';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { AvailabilityEvaluatorService } from './availability-evaluator.service';
import { AvailabilityTicketsService } from './availability-tickets.service';
import { AvailabilityIngestController } from './availability-ingest.controller';
import { AvailabilityIngestService } from './availability-ingest.service';
import { AvailabilityInventoryController } from './availability-inventory.controller';
import { AvailabilityInventoryService } from './availability-inventory.service';
import { DatacenterCrossChecker, NoopDatacenterCrossChecker } from './datacenter-cross-checker';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorIncidentEvent } from './entities/monitor-incident-event.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorOfficeOutage } from './entities/monitor-office-outage.entity';
import { MonitorProbeOrder } from './entities/monitor-probe-order.entity';
import { MonitorProbeSignal } from './entities/monitor-probe-signal.entity';
import { MonitorProbeState } from './entities/monitor-probe-state.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';
import { IncidentCloser } from './incident-closer';
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
      MonitorIncidentEvent,
      MonitorOfficeOutage,
    ]),
    ClientsModule,
    TicketsModule,
    UsersModule,
  ],
  controllers: [AvailabilityInventoryController, AvailabilityIngestController],
  providers: [
    AvailabilityInventoryService,
    AvailabilityIngestService,
    ProbeTokenGuard,
    ProbeRateLimiter,
    AvailabilityTicketsService,
    AvailabilityEvaluatorService,
    { provide: IncidentCloser, useExisting: AvailabilityEvaluatorService },
    // El worker (Task 10) lo sobrescribe con la sonda kubo-01 en proceso.
    { provide: DatacenterCrossChecker, useClass: NoopDatacenterCrossChecker },
  ],
  exports: [
    AvailabilityInventoryService,
    AvailabilityIngestService,
    AvailabilityTicketsService,
    AvailabilityEvaluatorService,
    IncidentCloser,
    DatacenterCrossChecker,
  ],
})
export class AvailabilityModule {}
