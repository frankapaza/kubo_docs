import { isInternalTicketOrigin } from '../tickets/entities/ticket.entity';
import { AvailabilityTicketsService } from './availability-tickets.service';

const MON_ID = 77;
const incident = {
  id: 5,
  kind: 'DOWN',
  firstFailureAt: new Date(),
  confirmedAt: new Date(),
} as any;
const ctx = (criticality: 'HIGH' | 'MEDIUM' | 'LOW') => ({
  clientId: 3,
  systemId: 9,
  criticality,
  serviceNames: ['API'],
  serverName: 'srv-01',
});

function make(over: { found?: any; byId?: any } = {}) {
  const tickets = {
    create: jest
      .fn()
      .mockImplementation(async (_a, dto) => ({
        id: 100,
        code: 'T-100',
        ...dto,
      })),
  };
  const transitions = { transition: jest.fn().mockResolvedValue({ id: 1 }) };
  const events = { record: jest.fn().mockResolvedValue({}) };
  const assignment = { overridePriority: jest.fn().mockResolvedValue({}) };
  const repo = {
    findByLabel: jest.fn().mockResolvedValue(over.found ?? null),
    findById: jest.fn().mockResolvedValue(over.byId ?? null),
    update: jest.fn().mockResolvedValue({}),
  };
  const users = { findByEmail: jest.fn().mockResolvedValue({ id: MON_ID }) };
  const svc = new AvailabilityTicketsService(
    tickets as any,
    transitions as any,
    events as any,
    assignment as any,
    repo as any,
    users as any,
  );
  return { svc, tickets, transitions, events, assignment, repo, users };
}

describe('AvailabilityTicketsService.ensureTicket', () => {
  it.each([
    ['HIGH', 'ALTA'],
    ['MEDIUM', 'MEDIA'],
    ['LOW', 'BAJA'],
  ] as const)(
    'crea ticket interno con urgencia según criticidad %s',
    async (crit, urgency) => {
      const { svc, tickets, repo } = make();
      await svc.ensureTicket(incident, ctx(crit));
      const [actor, dto, , requirement] = tickets.create.mock.calls[0];
      expect(requirement).toBe('EXENTO_SIN_QUIEN_ELIJA');
      expect(actor).toEqual({ kind: 'STAFF', userId: MON_ID });
      expect(dto.origin).toBe('MONITOREO');
      expect(isInternalTicketOrigin(dto.origin)).toBe(true);
      expect(dto.requestType).toBe('INCIDENCIA');
      expect(dto.serviceCategory).toBe('SOPORTE');
      expect(dto.impact).toBe('ALTO');
      expect(dto.urgency).toBe(urgency);
      expect(dto.assigneeUserId).toBeUndefined();
      expect(dto.clientId).toBe(3);
      expect(dto.systemId).toBe(9);
      expect(dto.labels).toEqual([
        'monitoreo',
        'disponibilidad',
        'monitoreo:incidente:5',
      ]);
      expect(repo.update).toHaveBeenCalledWith(100, { escalationLevel: 'N1' });
    },
  );

  it('no crea otro si ya hay ticket con la etiqueta', async () => {
    const existing = { id: 50, escalationLevel: 'N1' };
    const { svc, tickets } = make({ found: existing });
    const t = await svc.ensureTicket(incident, ctx('HIGH'));
    expect(t).toBe(existing);
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('sin sistema: systemId undefined', async () => {
    const { svc, tickets } = make();
    await svc.ensureTicket(incident, { ...ctx('LOW'), systemId: null });
    expect(tickets.create.mock.calls[0][1].systemId).toBeUndefined();
    expect(tickets.create.mock.calls[0][3]).toBe('EXENTO_SIN_QUIEN_ELIJA');
  });

  it('ticket existente sin nivel: reaplica N1', async () => {
    const { svc, repo } = make({ found: { id: 50, escalationLevel: null } });
    await svc.ensureTicket(incident, ctx('HIGH'));
    expect(repo.update).toHaveBeenCalledWith(50, { escalationLevel: 'N1' });
  });

  it('usa el diagnóstico dado', async () => {
    const { svc, tickets } = make();
    await svc.ensureTicket(incident, {
      ...ctx('LOW'),
      diagnosis: 'Puerto 443 cerrado',
    });
    expect(tickets.create.mock.calls[0][1].rawText).toContain(
      'Puerto 443 cerrado',
    );
  });

  it('falla con mensaje claro si falta el usuario de monitoreo', async () => {
    const { svc, users } = make();
    users.findByEmail.mockResolvedValue(null);
    await expect(svc.ensureTicket(incident, ctx('HIGH'))).rejects.toThrow(
      'Falta el usuario de monitoreo: aplicar la migración 031',
    );
  });

  it('resuelve el usuario una sola vez', async () => {
    const { svc, users } = make();
    await svc.ensureTicket(incident, ctx('LOW'));
    await svc.ensureTicket(incident, ctx('LOW'));
    expect(users.findByEmail).toHaveBeenCalledTimes(1);
  });
});

describe('AvailabilityTicketsService.reopenOrReplace', () => {
  it('RESUELTO: reabre con motivo', async () => {
    const { svc, transitions } = make({
      byId: { id: 8, status: 'RESUELTO', code: 'T-8' },
    });
    await svc.reopenOrReplace(incident, 8, ctx('HIGH'));
    expect(transitions.transition).toHaveBeenCalledWith({
      ticketId: 8,
      actorUserId: MON_ID,
      toStatus: 'EN_ATENCION',
      reason: 'El servicio volvió a caer antes de 30 minutos de recuperado.',
    });
  });

  it('CERRADO: ticket nuevo que cita el código anterior', async () => {
    const { svc, tickets, transitions } = make({
      byId: { id: 8, status: 'CERRADO', code: 'T-8' },
      found: { id: 8 },
    });
    const t = await svc.reopenOrReplace(incident, 8, ctx('HIGH'));
    expect(transitions.transition).not.toHaveBeenCalled();
    expect(tickets.create).toHaveBeenCalledTimes(1);
    expect(
      tickets.create.mock.calls[0][1].rawText.startsWith(
        'Continúa el incidente del ticket T-8',
      ),
    ).toBe(true);
    expect(t.id).toBe(100);
  });

  it('CERRADO con reemplazo abierto ya creado: lo reutiliza', async () => {
    const newer = { id: 120, status: 'EN_ATENCION' };
    const { svc, tickets } = make({
      byId: { id: 8, status: 'CERRADO', code: 'T-8' },
      found: newer,
    });
    const t = await svc.reopenOrReplace(incident, 8, ctx('HIGH'));
    expect(tickets.create).not.toHaveBeenCalled();
    expect(t).toBe(newer);
  });

  it('EN_ATENCION: solo comentario', async () => {
    const { svc, transitions, tickets, events } = make({
      byId: { id: 8, status: 'EN_ATENCION', code: 'T-8' },
    });
    const t = await svc.reopenOrReplace(incident, 8, ctx('HIGH'));
    expect(transitions.transition).not.toHaveBeenCalled();
    expect(tickets.create).not.toHaveBeenCalled();
    expect(events.record).toHaveBeenCalledTimes(1);
    expect(events.record.mock.calls[0][0]).toMatchObject({
      ticketId: 8,
      type: 'COMMENT',
      actorUserId: MON_ID,
    });
    expect(t.id).toBe(8);
  });
});

describe('AvailabilityTicketsService.raisePriority', () => {
  it('sube de P2 a P1', async () => {
    const { svc, assignment } = make({ byId: { id: 8, priority: 'P2' } });
    await svc.raisePriority(8, 'HIGH');
    expect(assignment.overridePriority).toHaveBeenCalledWith({
      ticketId: 8,
      actorUserId: MON_ID,
      impact: 'ALTO',
      urgency: 'ALTA',
      reason: 'Se sumó un servicio más crítico al incidente de servidor',
    });
  });

  it('no baja: P1 con LOW no hace nada', async () => {
    const { svc, assignment } = make({ byId: { id: 8, priority: 'P1' } });
    await svc.raisePriority(8, 'LOW');
    expect(assignment.overridePriority).not.toHaveBeenCalled();
  });
});

describe('AvailabilityTicketsService.comment', () => {
  it('registra COMMENT con source DISPONIBILIDAD', async () => {
    const { svc, events } = make();
    await svc.comment(8, 'hola', { a: 1 });
    expect(events.record).toHaveBeenCalledWith({
      ticketId: 8,
      type: 'COMMENT',
      actorUserId: MON_ID,
      reason: 'hola',
      payload: { source: 'DISPONIBILIDAD', a: 1 },
    });
  });
});
