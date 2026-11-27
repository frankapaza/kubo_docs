import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmOptionsFactory } from '../../config/typeorm.options';
import { AvailabilityIngestService } from './availability-ingest.service';
import { DatacenterProbeService } from './datacenter-probe.service';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorProbeOrder } from './entities/monitor-probe-order.entity';
import { MonitorProbeSignal } from './entities/monitor-probe-signal.entity';
import { MonitorProbeState } from './entities/monitor-probe-state.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';

/**
 * Raíz del contenedor monitor-worker: SOLO mide. Sin TicketsModule, BullMQ ni
 * ScheduleModule (arrastrarían los consumidores de colas y los cron del backend);
 * el evaluador y la purga corren en el backend.
 */
export const WORKER_ENTITIES = [
  MonitorProbe,
  MonitorService,
  MonitorServer,
  MonitorCheck,
  MonitorProbeSignal,
  MonitorProbeOrder,
  MonitorProbeState,
  MonitorIncident,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: typeOrmOptionsFactory }),
    TypeOrmModule.forFeature(WORKER_ENTITIES),
  ],
  providers: [AvailabilityIngestService, DatacenterProbeService],
})
export class AvailabilityWorkerModule {}
