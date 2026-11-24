import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AvailabilityEvaluatorScheduler } from './availability-evaluator.scheduler';
import { AvailabilityEvaluatorService } from './availability-evaluator.service';
import { AvailabilityPurgeService } from './availability-purge.service';
import { AvailabilityTicketsService } from './availability-tickets.service';
import { AvailabilityModule } from './availability.module';
import { IncidentCloser } from './incident-closer';

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
});
