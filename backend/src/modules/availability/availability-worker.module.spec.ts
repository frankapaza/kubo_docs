import { BullModule } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AvailabilityEvaluatorScheduler } from './availability-evaluator.scheduler';
import { AvailabilityEvaluatorService } from './availability-evaluator.service';
import { AvailabilityIngestService } from './availability-ingest.service';
import { AvailabilityPurgeService } from './availability-purge.service';
import { AvailabilityWorkerModule, WORKER_ENTITIES } from './availability-worker.module';
import { MonitorMaintenance } from './entities/monitor-maintenance.entity';
import { DatacenterProbeService } from './datacenter-probe.service';
import { AvailabilityModule } from './availability.module';
import { TicketsModule } from '../tickets/tickets.module';
import { TranscriptionsModule } from '../transcriptions/transcriptions.module';

/** Todas las clases de módulo alcanzables desde `root` (estáticas y dinámicas). */
function reachable(root: any, seen = new Set<any>()): Set<any> {
  const mod = root && root.module ? root.module : root;
  if (!mod || seen.has(mod)) return seen;
  seen.add(mod);
  const imports = [
    ...((Reflect.getMetadata('imports', mod) as any[]) ?? []),
    ...((root && root.imports) as any[] ?? []),
  ];
  for (const i of imports) reachable(i, seen);
  return seen;
}

describe('AvailabilityWorkerModule (solo mide)', () => {
  const modules = reachable(AvailabilityWorkerModule);
  const providers = (Reflect.getMetadata('providers', AvailabilityWorkerModule) ?? []) as any[];

  it('no arrastra Tickets, Transcripciones, BullMQ ni Schedule (consumidores de colas y cron del backend)', () => {
    for (const forbidden of [TicketsModule, TranscriptionsModule, BullModule, ScheduleModule, AvailabilityModule]) {
      expect(modules.has(forbidden)).toBe(false);
    }
  });

  it('la ingesta se resuelve con solo las entidades del worker (sin MonitorMaintenance)', async () => {
    expect(WORKER_ENTITIES).not.toContain(MonitorMaintenance);
    const moduleRef = await Test.createTestingModule({
      providers: [AvailabilityIngestService, ...WORKER_ENTITIES.map((e) => ({ provide: getRepositoryToken(e), useValue: {} }))],
    }).compile();
    expect(moduleRef.get(AvailabilityIngestService)).toBeInstanceOf(AvailabilityIngestService);
  });

  it('solo registra la ingesta y la sonda: ni evaluador, ni tick, ni purga', () => {
    expect(providers).toEqual([AvailabilityIngestService, DatacenterProbeService]);
    for (const p of [AvailabilityEvaluatorService, AvailabilityEvaluatorScheduler, AvailabilityPurgeService]) {
      expect(providers).not.toContain(p);
    }
  });
});
