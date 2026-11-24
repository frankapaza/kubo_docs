import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { bullOptionsFactory, typeOrmOptionsFactory } from '../../config/typeorm.options';
import { AvailabilityModule } from './availability.module';
import { AvailabilityPurgeService } from './availability-purge.service';
import { DatacenterCrossChecker } from './datacenter-cross-checker';
import { DatacenterProbeService } from './datacenter-probe.service';

/**
 * AvailabilityModule con la sonda kubo-01 en proceso. Un proveedor sobrescrito
 * desde fuera no llegaría al evaluador (que vive dentro de AvailabilityModule),
 * así que el worker añade el suyo al mismo módulo: Nest da prioridad al último
 * proveedor con el mismo token, y `DatacenterCrossChecker` pasa a ser la sonda.
 */
export const availabilityWithProbe: DynamicModule = {
  module: AvailabilityModule,
  providers: [
    DatacenterProbeService,
    AvailabilityPurgeService,
    { provide: DatacenterCrossChecker, useExisting: DatacenterProbeService },
  ],
};

/** Raíz del contenedor monitor-worker: sin HTTP, solo sonda, tick del evaluador y purga. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: typeOrmOptionsFactory }),
    // TicketsModule (vía AvailabilityModule) registra colas BullMQ.
    BullModule.forRootAsync({ inject: [ConfigService], useFactory: bullOptionsFactory }),
    availabilityWithProbe,
  ],
})
export class AvailabilityWorkerModule {}
