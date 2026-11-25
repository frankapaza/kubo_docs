import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AvailabilityEvaluatorScheduler } from './availability-evaluator.scheduler';
import { AvailabilityEvaluatorService } from './availability-evaluator.service';
import { AvailabilityPurgeService } from './availability-purge.service';
import { AvailabilityRollupService } from './availability-rollup.service';
import { AvailabilityIngestController } from './availability-ingest.controller';
import { AvailabilitySyncService } from './availability-sync.service';
import { TicketsRepository } from '../tickets/tickets.repository';
import { AvailabilityTicketsService } from './availability-tickets.service';
import { AvailabilityModule } from './availability.module';
import { IncidentCloser } from './incident-closer';
import { ProbeSilenceWatch } from './probe-silence.watch';
import { AgentSilenceWatch } from './agent-silence.watch';
import { AgentRateLimiter } from './agent-rate-limiter';
import { AgentTokenGuard } from './agent-token.guard';
import { AvailabilityAgentController } from './availability-agent.controller';
import { AvailabilityAgentService } from './availability-agent.service';

describe('AvailabilityModule', () => {
  const providers = (Reflect.getMetadata('providers', AvailabilityModule) ?? []) as any[];

  it('IncidentCloser lo implementa el evaluador (no queda el doble Noop)', () => {
    const binding = providers.find((p) => p && p.provide === IncidentCloser);
    expect(binding).toEqual({ provide: IncidentCloser, useExisting: AvailabilityEvaluatorService });
    expect(providers).toContain(AvailabilityEvaluatorService);
  });

  it('el tick del evaluador y la purga se registran en el backend (AvailabilityModule)', () => {
    expect(providers).toContain(AvailabilityEvaluatorScheduler);
    expect(providers).toContain(AvailabilityPurgeService);
  });

  it('los resúmenes diarios corren en el backend (cron en AvailabilityModule)', () => {
    expect(providers).toContain(AvailabilityRollupService);
  });

  it('el vigilante de silencio de sondas corre en el backend', () => {
    expect(providers).toContain(ProbeSilenceWatch);
  });

  it('la ingesta del agente y su vigilante de silencio viven en el backend', () => {
    for (const p of [AgentSilenceWatch, AvailabilityAgentService, AgentTokenGuard, AgentRateLimiter]) expect(providers).toContain(p);
    expect(Reflect.getMetadata('controllers', AvailabilityModule)).toContain(AvailabilityAgentController);
  });

  it('el evaluador se resuelve sin sonda local (el cruce va por monitor_probe_orders)', async () => {
    const binding = providers.find((p) => p && p.provide === IncidentCloser);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AvailabilityEvaluatorService,
        binding,
        { provide: DataSource, useValue: { manager: {}, transaction: jest.fn() } },
        { provide: AvailabilityTicketsService, useValue: {} },
      ],
    }).compile();
    expect(moduleRef.get(IncidentCloser)).toBe(moduleRef.get(AvailabilityEvaluatorService));
  });

  it('sync con ticket: el controlador de ingesta depende de AvailabilitySyncService, que exige TicketsRepository', () => {
    expect(providers).toContain(AvailabilitySyncService);
    expect(Reflect.getMetadata('design:paramtypes', AvailabilityIngestController)).toContain(AvailabilitySyncService);
    expect(Reflect.getMetadata('design:paramtypes', AvailabilitySyncService)).toContain(TicketsRepository);
    expect(Reflect.getMetadata('optional:paramtypes', AvailabilitySyncService)).toBeUndefined();
  });

  it('sin TicketsRepository AvailabilitySyncService no se resuelve (el arranque falla)', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          AvailabilitySyncService,
          { provide: 'MonitorIncidentRepository', useValue: {} },
          { provide: 'AvailabilityIngestService', useValue: {} },
        ],
      }).compile(),
    ).rejects.toThrow();
  });
});

describe('AvailabilityModule: informe mensual', () => {
  it('el informe mensual (servicio con cron y controlador) vive en el backend, no en el worker', () => {
    const { AvailabilityReportService } = require('./availability-report.service');
    const { AvailabilityReportController } = require('./availability-report.controller');
    const { AvailabilityWorkerModule } = require('./availability-worker.module');
    expect(Reflect.getMetadata('providers', AvailabilityModule)).toContain(AvailabilityReportService);
    expect(Reflect.getMetadata('controllers', AvailabilityModule)).toContain(AvailabilityReportController);
    expect(Reflect.getMetadata('providers', AvailabilityWorkerModule) ?? []).not.toContain(AvailabilityReportService);
  });
});
