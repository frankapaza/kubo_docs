import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../../common/storage/storage.module';
import { User } from '../users/entities/user.entity';
import { AvailabilityEvidenceController } from './availability-evidence.controller';
import { AvailabilityEvidenceService } from './availability-evidence.service';
import { EmailModule } from '../email/email.module';
import { ClientsModule } from '../clients/clients.module';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { AgentRateLimiter } from './agent-rate-limiter';
import { AgentSilenceWatch } from './agent-silence.watch';
import { AgentTokenGuard } from './agent-token.guard';
import { AvailabilityAgentController } from './availability-agent.controller';
import { AvailabilityAgentService } from './availability-agent.service';
import { AvailabilityEvaluatorService } from './availability-evaluator.service';
import { AvailabilityTicketsService } from './availability-tickets.service';
import { AvailabilityIngestController } from './availability-ingest.controller';
import { AvailabilitySyncService } from './availability-sync.service';
import { AvailabilityIngestService } from './availability-ingest.service';
import { AvailabilityInventoryController } from './availability-inventory.controller';
import { AvailabilityInventoryService } from './availability-inventory.service';
import { AvailabilityMaintenanceController } from './availability-maintenance.controller';
import { AvailabilityMaintenanceService } from './availability-maintenance.service';
import { AvailabilityEvaluatorScheduler } from './availability-evaluator.scheduler';
import { AvailabilityStateController } from './availability-state.controller';
import { AvailabilityStateService } from './availability-state.service';
import { AvailabilityPurgeService } from './availability-purge.service';
import { AvailabilityRollupService } from './availability-rollup.service';
import { AvailabilityReportController } from './availability-report.controller';
import { AvailabilityReportService } from './availability-report.service';
import { MonitorAgentDailyRollup } from './entities/monitor-agent-daily-rollup.entity';
import { MonitorAgentSample } from './entities/monitor-agent-sample.entity';
import { MonitorDailyRollup } from './entities/monitor-daily-rollup.entity';
import { MonitorEvidence } from './entities/monitor-evidence.entity';
import { MonitorMaintenance } from './entities/monitor-maintenance.entity';
import { MonitorMonthlyReport } from './entities/monitor-monthly-report.entity';
import { MonitorProbeGap } from './entities/monitor-probe-gap.entity';
import { MonitorRollupDay } from './entities/monitor-rollup-day.entity';
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
import { ProbeSilenceWatch } from './probe-silence.watch';
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
      MonitorAgentDailyRollup,
      MonitorAgentSample,
      MonitorDailyRollup,
      MonitorEvidence,
      User,
      MonitorMaintenance,
      MonitorMonthlyReport,
      MonitorProbeGap,
      MonitorRollupDay,
    ]),
    ClientsModule,
    TicketsModule,
    UsersModule,
    EmailModule,
    StorageModule,
  ],
  controllers: [
    AvailabilityInventoryController,
    AvailabilityIngestController,
    AvailabilityAgentController,
    AvailabilityStateController,
    AvailabilityMaintenanceController,
    AvailabilityEvidenceController,
    AvailabilityReportController,
  ],
  providers: [
    AvailabilityInventoryService,
    AvailabilityIngestService,
    AvailabilitySyncService,
    AvailabilityStateService,
    AvailabilityEvidenceService,
    AvailabilityMaintenanceService,
    ProbeTokenGuard,
    ProbeRateLimiter,
    // Agente de servidor (solo backend: el worker sigue midiendo sondas y nada más).
    AvailabilityAgentService,
    AgentTokenGuard,
    AgentRateLimiter,
    AvailabilityTicketsService,
    AvailabilityEvaluatorService,
    { provide: IncidentCloser, useExisting: AvailabilityEvaluatorService },
    // Evaluación y purga corren en el backend; el worker (kubo-01) solo mide.
    AvailabilityEvaluatorScheduler,
    AvailabilityPurgeService,
    // Resúmenes diarios (00:30 Lima y al arrancar): base del informe mensual. Solo backend.
    AvailabilityRollupService,
    // Informe mensual (día 1 a las 08:00 Lima y recuperación al arrancar). Solo backend.
    AvailabilityReportService,
    // Aviso por correo cuando una sonda calla 10 min (solo backend, con ScheduleModule).
    ProbeSilenceWatch,
    // Ídem cuando el agente de un servidor calla 10 min.
    AgentSilenceWatch,
  ],
  exports: [
    AvailabilityInventoryService,
    AvailabilityIngestService,
    AvailabilityTicketsService,
    AvailabilityEvaluatorService,
    IncidentCloser,
  ],
})
export class AvailabilityModule {}
