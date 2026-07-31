import { TicketTransitionsService } from './ticket-transitions.service';
import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { TicketStatus } from './domain/ticket-state-machine';

const ticketRow = (over: Partial<Ticket> = {}): Ticket =>
  ({
    id: 1,
    status: 'EN_ATENCION' as TicketStatus,
    createdAt: new Date('2026-07-31T08:00:00.000Z'),
    pausedAt: null,
    pausedTotalSeconds: 0,
    slaResponseDueAt: new Date('2026-07-31T08:15:00.000Z'),
    slaResolutionDueAt: new Date('2026-07-31T12:00:00.000Z'),
    firstResponseAt: null,
    ...over,
  }) as Ticket;

/**
 * El servicio real escribe el cambio de estado y el evento de timeline con
 * el EntityManager de una única transacción (ver comentario en
 * ticket-transitions.service.ts), no con los repositorios/servicios
 * inyectados. Estos dobles imitan esa forma: `runInTransaction` invoca el
 * callback con un `manager` falso cuyo `getRepository` devuelve un stub por
 * entidad, para poder seguir verificando las reglas reales (qué campos se
 * escriben, qué se lanza) en vez de la plomería de la transacción.
 */
const makeService = (current: Ticket) => {
  let ticketState = current;

  const ticketRepoStub = {
    update: jest.fn().mockImplementation((_id: number, patch: Partial<Ticket>) => {
      ticketState = { ...ticketState, ...patch };
      return Promise.resolve({ affected: 1 });
    }),
    findOneBy: jest.fn().mockImplementation(() => Promise.resolve(ticketState)),
  };

  const eventRepoStub = {
    create: jest.fn().mockImplementation((data: unknown) => data),
    save: jest.fn().mockImplementation((data: unknown) => Promise.resolve({ id: 99, ...(data as object) })),
  };

  const manager = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === Ticket) return ticketRepoStub;
      if (entity === TicketEvent) return eventRepoStub;
      throw new Error(`getRepository inesperado: ${String(entity)}`);
    }),
  };

  const repo = {
    findById: jest.fn().mockResolvedValue(current),
    runInTransaction: jest.fn().mockImplementation((work: (m: unknown) => Promise<unknown>) => work(manager)),
  };
  const events = {
    typeForTransition: jest.fn().mockReturnValue('STATUS_CHANGED'),
  };
  const sla = {
    applyPause: jest.fn().mockReturnValue({
      pausedTotalSeconds: 1800,
      slaResponseDueAt: new Date('2026-07-31T08:45:00.000Z'),
      slaResolutionDueAt: new Date('2026-07-31T12:30:00.000Z'),
      pausedAt: null,
    }),
  };
  return {
    service: new TicketTransitionsService(repo as any, events as any, sla as any),
    repo,
    events,
    sla,
    ticketRepoStub,
    eventRepoStub,
  };
};

describe('transition', () => {
  it('rechaza una transicion invalida', async () => {
    const { service } = makeService(ticketRow({ status: 'NUEVO' }));
    await expect(
      service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'RESUELTO' }),
    ).rejects.toThrow();
  });

  it('exige motivo al derivar', async () => {
    const { service } = makeService(ticketRow());
    await expect(
      service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'DERIVADO' }),
    ).rejects.toThrow();
  });

  it('acepta derivar con motivo y registra el evento', async () => {
    const { service, eventRepoStub } = makeService(ticketRow());
    await service.transition({
      ticketId: 1,
      actorUserId: 5,
      toStatus: 'DERIVADO',
      reason: 'Saturacion del pool de conexiones',
    });
    expect(eventRepoStub.save).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'DERIVADO', reason: 'Saturacion del pool de conexiones' }),
    );
  });

  it('rechaza RESUELTO sin solucion, causa raiz o accion correctiva', async () => {
    const { service } = makeService(ticketRow());
    await expect(
      service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'RESUELTO' }),
    ).rejects.toThrow();
    await expect(
      service.transition({
        ticketId: 1,
        actorUserId: 5,
        toStatus: 'RESUELTO',
        resolutionMd: 'Se amplio el pool',
        rootCause: 'Configuracion insuficiente',
      }),
    ).rejects.toThrow();
  });

  it('acepta RESUELTO con la evidencia completa y sella resolved_at', async () => {
    const { service, ticketRepoStub } = makeService(ticketRow());
    await service.transition({
      ticketId: 1,
      actorUserId: 5,
      toStatus: 'RESUELTO',
      resolutionMd: 'Se amplio el pool a 120',
      rootCause: 'Configuracion insuficiente para el crecimiento',
      correctiveAction: 'CHG-061: alerta al 70% de saturacion',
    });
    const patch = ticketRepoStub.update.mock.calls[0][1];
    expect(patch.status).toBe('RESUELTO');
    expect(patch.resolvedAt).toBeInstanceOf(Date);
  });

  it('al entrar en ESPERA_CLIENTE marca paused_at', async () => {
    const { service, ticketRepoStub } = makeService(ticketRow());
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'ESPERA_CLIENTE' });
    expect(ticketRepoStub.update.mock.calls[0][1].pausedAt).toBeInstanceOf(Date);
  });

  it('al salir de ESPERA_CLIENTE desplaza los vencimientos', async () => {
    const { service, ticketRepoStub, sla } = makeService(
      ticketRow({ status: 'ESPERA_CLIENTE', pausedAt: new Date('2026-07-31T09:00:00.000Z') }),
    );
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'EN_ATENCION' });
    expect(sla.applyPause).toHaveBeenCalled();
    const patch = ticketRepoStub.update.mock.calls[0][1];
    expect(patch.pausedAt).toBeNull();
    expect(patch.pausedTotalSeconds).toBe(1800);
  });

  it('la primera entrada en EN_ATENCION fija first_response_at', async () => {
    const { service, ticketRepoStub } = makeService(ticketRow({ status: 'ASIGNADO', firstResponseAt: null }));
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'EN_ATENCION' });
    expect(ticketRepoStub.update.mock.calls[0][1].firstResponseAt).toBeInstanceOf(Date);
  });

  it('no reescribe first_response_at si ya existe', async () => {
    const previo = new Date('2026-07-31T08:03:00.000Z');
    const { service, ticketRepoStub } = makeService(
      ticketRow({ status: 'ESPERA_CLIENTE', pausedAt: new Date(), firstResponseAt: previo }),
    );
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'EN_ATENCION' });
    expect(ticketRepoStub.update.mock.calls[0][1].firstResponseAt).toBeUndefined();
  });

  it('cerrar desde RESUELTO no exige motivo y sella closed_at', async () => {
    const { service, ticketRepoStub } = makeService(ticketRow({ status: 'RESUELTO' }));
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'CERRADO' });
    expect(ticketRepoStub.update.mock.calls[0][1].closedAt).toBeInstanceOf(Date);
  });

  it('cancelar desde un estado abierto exige motivo', async () => {
    const { service } = makeService(ticketRow());
    await expect(
      service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'CERRADO' }),
    ).rejects.toThrow();
  });

  it('reabrir limpia resolved_at y conserva la solucion', async () => {
    const { service, ticketRepoStub } = makeService(
      ticketRow({ status: 'RESUELTO', resolvedAt: new Date(), resolutionMd: 'texto previo' } as Partial<Ticket>),
    );
    await service.transition({
      ticketId: 1,
      actorUserId: 5,
      toStatus: 'EN_ATENCION',
      reason: 'El cliente reporta que persiste',
    });
    const patch = ticketRepoStub.update.mock.calls[0][1];
    expect(patch.resolvedAt).toBeNull();
    expect(patch.resolutionMd).toBeUndefined();
  });

  it('resolver desde ESPERA_CLIENTE desplaza vencimientos y sella la evidencia a la vez', async () => {
    const { service, ticketRepoStub, sla } = makeService(
      ticketRow({ status: 'ESPERA_CLIENTE', pausedAt: new Date('2026-07-31T09:00:00.000Z') }),
    );
    await service.transition({
      ticketId: 1,
      actorUserId: 5,
      toStatus: 'RESUELTO',
      resolutionMd: 'Se amplio el pool a 120',
      rootCause: 'Configuracion insuficiente para el crecimiento',
      correctiveAction: 'CHG-061: alerta al 70% de saturacion',
    });
    expect(sla.applyPause).toHaveBeenCalled();
    const patch = ticketRepoStub.update.mock.calls[0][1];
    // Lado de la pausa: se reanuda el reloj.
    expect(patch.pausedAt).toBeNull();
    expect(patch.pausedTotalSeconds).toBe(1800);
    expect(patch.slaResponseDueAt).toEqual(new Date('2026-07-31T08:45:00.000Z'));
    expect(patch.slaResolutionDueAt).toEqual(new Date('2026-07-31T12:30:00.000Z'));
    // Lado de la resolucion: la evidencia se sella igual que resolviendo desde EN_ATENCION.
    expect(patch.status).toBe('RESUELTO');
    expect(patch.resolvedAt).toBeInstanceOf(Date);
    expect(patch.resolutionMd).toBe('Se amplio el pool a 120');
    expect(patch.rootCause).toBe('Configuracion insuficiente para el crecimiento');
    expect(patch.correctiveAction).toBe('CHG-061: alerta al 70% de saturacion');
  });

  it('acepta RESUELTO sin evidencia en el body si el ticket ya la tenia', async () => {
    const { service, ticketRepoStub } = makeService(
      ticketRow({
        resolutionMd: 'Se amplio el pool a 120',
        rootCause: 'Configuracion insuficiente para el crecimiento',
        correctiveAction: 'CHG-061: alerta al 70% de saturacion',
      } as Partial<Ticket>),
    );
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'RESUELTO' });
    const patch = ticketRepoStub.update.mock.calls[0][1];
    expect(patch.status).toBe('RESUELTO');
    expect(patch.resolvedAt).toBeInstanceOf(Date);
    expect(patch.resolutionMd).toBe('Se amplio el pool a 120');
    expect(patch.rootCause).toBe('Configuracion insuficiente para el crecimiento');
    expect(patch.correctiveAction).toBe('CHG-061: alerta al 70% de saturacion');
  });

  it('escribe el estado y el evento dentro de la misma transaccion', async () => {
    const { service, repo, ticketRepoStub, eventRepoStub } = makeService(ticketRow());
    await service.transition({
      ticketId: 1,
      actorUserId: 5,
      toStatus: 'ESPERA_CLIENTE',
    });
    expect(repo.runInTransaction).toHaveBeenCalledTimes(1);
    // Ambas escrituras deben pasar por el manager de la transaccion, nunca
    // por repo.update/events.recordStatusChange directamente.
    expect(ticketRepoStub.update).toHaveBeenCalledTimes(1);
    expect(eventRepoStub.save).toHaveBeenCalledTimes(1);
  });
});
