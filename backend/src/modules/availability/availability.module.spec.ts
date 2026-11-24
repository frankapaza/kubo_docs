import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AvailabilityEvaluatorService } from './availability-evaluator.service';
import { AvailabilityTicketsService } from './availability-tickets.service';
import { AvailabilityModule } from './availability.module';
import { DatacenterCrossChecker, NoopDatacenterCrossChecker } from './datacenter-cross-checker';
import { IncidentCloser } from './incident-closer';

describe('AvailabilityModule', () => {
  const providers = (Reflect.getMetadata('providers', AvailabilityModule) ?? []) as any[];

  it('IncidentCloser lo implementa el evaluador (no queda el doble Noop)', () => {
    const binding = providers.find((p) => p && p.provide === IncidentCloser);
    expect(binding).toEqual({ provide: IncidentCloser, useExisting: AvailabilityEvaluatorService });
    expect(providers).toContain(AvailabilityEvaluatorService);
  });

  it('DatacenterCrossChecker tiene un proveedor por defecto que el worker sobrescribe', () => {
    const binding = providers.find((p) => p && p.provide === DatacenterCrossChecker);
    expect(binding).toEqual({ provide: DatacenterCrossChecker, useClass: NoopDatacenterCrossChecker });
  });

  it('con esas mismas definiciones, IncidentCloser resuelve a la instancia del evaluador', async () => {
    const binding = providers.find((p) => p && p.provide === IncidentCloser);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AvailabilityEvaluatorService,
        binding,
        { provide: DatacenterCrossChecker, useClass: NoopDatacenterCrossChecker },
        { provide: DataSource, useValue: { manager: {}, transaction: jest.fn() } },
        { provide: AvailabilityTicketsService, useValue: {} },
      ],
    }).compile();
    expect(moduleRef.get(IncidentCloser)).toBe(moduleRef.get(AvailabilityEvaluatorService));
  });
});
