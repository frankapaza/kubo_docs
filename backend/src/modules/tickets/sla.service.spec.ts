import { SlaService } from './sla.service';
import { DEFAULT_SLA_MATRIX } from './domain/sla.calculator';
import { SlaPolicy } from './entities/sla-policy.entity';
import { Ticket } from './entities/ticket.entity';

const policyRow = (over: Partial<SlaPolicy> = {}): SlaPolicy =>
  ({
    id: 1,
    name: 'Estándar',
    isDefault: 1,
    p1ResponseMinutes: 15,
    p1ResolutionMinutes: 240,
    p2ResponseMinutes: 30,
    p2ResolutionMinutes: 360,
    p3ResponseMinutes: 60,
    p3ResolutionMinutes: 720,
    p4ResponseMinutes: 240,
    p4ResolutionMinutes: 1440,
    coverage: null,
    ...over,
  }) as SlaPolicy;

const makeService = (opts: {
  defaultPolicy?: SlaPolicy | null;
  byId?: SlaPolicy | null;
  clientPolicyId?: number | null;
}) => {
  const policies = {
    findDefault: jest.fn().mockResolvedValue(opts.defaultPolicy ?? null),
    findById: jest.fn().mockResolvedValue(opts.byId ?? null),
  };
  const clients = {
    findByIdOrFail: jest.fn().mockResolvedValue({ id: 9, slaPolicyId: opts.clientPolicyId ?? null }),
  };
  return {
    service: new SlaService(policies as any, clients as any),
    policies,
    clients,
  };
};

describe('resolveMatrixForClient', () => {
  it('usa la politica del cliente cuando la tiene', async () => {
    const custom = policyRow({ id: 7, p1ResolutionMinutes: 120 });
    const { service, policies } = makeService({ byId: custom, clientPolicyId: 7 });

    const r = await service.resolveMatrixForClient(9);

    expect(policies.findById).toHaveBeenCalledWith(7);
    expect(r.policyId).toBe(7);
    expect(r.matrix.P1.resolutionMinutes).toBe(120);
  });

  it('cae a la politica por defecto si el cliente no tiene una', async () => {
    const { service } = makeService({ defaultPolicy: policyRow(), clientPolicyId: null });
    const r = await service.resolveMatrixForClient(9);
    expect(r.policyId).toBe(1);
    expect(r.matrix.P1.resolutionMinutes).toBe(240);
  });

  it('cae a la matriz embebida si no hay ninguna politica en BD', async () => {
    const { service } = makeService({ defaultPolicy: null, clientPolicyId: null });
    const r = await service.resolveMatrixForClient(null);
    expect(r.policyId).toBeNull();
    expect(r.matrix).toEqual(DEFAULT_SLA_MATRIX);
  });
});

describe('initForTicket', () => {
  it('calcula los vencimientos con la matriz resuelta', async () => {
    const { service } = makeService({ defaultPolicy: policyRow(), clientPolicyId: null });
    const createdAt = new Date('2026-07-31T08:00:00.000Z');

    const r = await service.initForTicket({ clientId: null, createdAt, priority: 'P1' });

    expect(r.slaPolicyId).toBe(1);
    expect(r.slaResponseDueAt!.toISOString()).toBe('2026-07-31T08:15:00.000Z');
    expect(r.slaResolutionDueAt!.toISOString()).toBe('2026-07-31T12:00:00.000Z');
  });
});

describe('applyPause', () => {
  it('acumula segundos y desplaza los vencimientos', () => {
    const { service } = makeService({});
    const ticket = {
      pausedAt: new Date('2026-07-31T09:00:00.000Z'),
      pausedTotalSeconds: 600,
      slaResponseDueAt: new Date('2026-07-31T08:15:00.000Z'),
      slaResolutionDueAt: new Date('2026-07-31T12:00:00.000Z'),
    } as Ticket;

    const r = service.applyPause(ticket, new Date('2026-07-31T09:30:00.000Z'));

    expect(r.pausedTotalSeconds).toBe(600 + 1800);
    expect(r.slaResolutionDueAt!.toISOString()).toBe('2026-07-31T12:30:00.000Z');
    expect(r.pausedAt).toBeNull();
  });

  it('es inocuo si el ticket no estaba pausado', () => {
    const { service } = makeService({});
    const ticket = {
      pausedAt: null,
      pausedTotalSeconds: 0,
      slaResponseDueAt: new Date('2026-07-31T08:15:00.000Z'),
      slaResolutionDueAt: new Date('2026-07-31T12:00:00.000Z'),
    } as Ticket;

    const r = service.applyPause(ticket, new Date('2026-07-31T09:30:00.000Z'));

    expect(r.pausedTotalSeconds).toBe(0);
    expect(r.slaResolutionDueAt!.toISOString()).toBe('2026-07-31T12:00:00.000Z');
  });
});

describe('evaluateRisk', () => {
  it('es falso sin plazo de resolucion', () => {
    const { service } = makeService({});
    const ticket = { slaResolutionDueAt: null } as Ticket;
    expect(service.evaluateRisk(ticket, new Date())).toBe(false);
  });

  it('marca riesgo al 70% del plazo', () => {
    const { service } = makeService({});
    const ticket = {
      createdAt: new Date('2026-07-31T08:00:00.000Z'),
      slaResolutionDueAt: new Date('2026-07-31T12:00:00.000Z'), // 240 min
      pausedTotalSeconds: 0,
      pausedAt: null,
    } as Ticket;

    expect(service.evaluateRisk(ticket, new Date('2026-07-31T10:47:00.000Z'))).toBe(false);
    expect(service.evaluateRisk(ticket, new Date('2026-07-31T10:48:00.000Z'))).toBe(true);
  });
});
