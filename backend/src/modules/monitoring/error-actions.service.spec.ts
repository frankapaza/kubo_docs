import { BadRequestException, ConflictException } from '@nestjs/common';

import { ErrorActionsService } from './error-actions.service';

const baseRow = (over: Record<string, unknown> = {}) => ({
  id: '5',
  title: 'Boom',
  aplicativo: 'Facturador',
  logger: 'Acme.Log',
  client_id: '7',
  system_id: '3',
  status: 'NUEVO',
  first_seen_at: new Date('2026-11-07T03:30:00.000Z'),
  last_seen_at: new Date('2026-11-07T15:00:00.000Z'),
  occurrences_total: '10',
  servers: ['SRV-01'],
  ...over,
});

const make = (row: Record<string, unknown> | null = baseRow()) => {
  const repo = {
    findRowById: jest.fn().mockResolvedValue(row),
    findReservationState: jest
      .fn()
      .mockResolvedValue({ status: row?.status ?? 'NUEVO', ticketId: null, ticketLinkedBy: null, ticketLinkedAt: null }),
    reserveForTicket: jest.fn().mockResolvedValue(true),
    attachTicket: jest.fn().mockResolvedValue(undefined),
    restoreReservation: jest.fn().mockResolvedValue(undefined),
    markResolved: jest.fn().mockResolvedValue(true),
    markReopened: jest.fn().mockResolvedValue(true),
    listOccurrences: jest.fn().mockResolvedValue([{ message: 'm', exception: 'trace' }]),
  };
  const groups = { detail: jest.fn().mockResolvedValue({ id: 5 }) };
  const tickets = { create: jest.fn().mockResolvedValue({ id: '99', code: 'TK-99' }) };
  const clientSystems = { findByClientAndSystem: jest.fn().mockResolvedValue({ id: '21' }) };
  const gateway = { notifyErrorsChanged: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('https://app.test') };
  const service = new ErrorActionsService(
    repo as any,
    groups as any,
    tickets as any,
    clientSystems as any,
    gateway as any,
    config as any,
  );
  return { service, repo, groups, tickets, clientSystems, gateway };
};

describe('ErrorActionsService.createTicket', () => {
  it('crea el ticket con origen MONITOREO, actor del equipo, INCIDENCIA/SOFTWARE y la asignación del cliente y producto del grupo', async () => {
    const { service, tickets, clientSystems, repo, gateway } = make();
    const r = await service.createTicket(5, 11, {});
    expect(clientSystems.findByClientAndSystem).toHaveBeenCalledWith(7, 3);
    const [actor, dto, email, req] = tickets.create.mock.calls[0];
    expect(actor).toEqual({ kind: 'STAFF', userId: 11 });
    expect(dto).toMatchObject({
      origin: 'MONITOREO',
      requestType: 'INCIDENCIA',
      serviceCategory: 'SOFTWARE',
      clientId: 7,
      systemId: 21,
      subject: 'Boom',
    });
    expect(dto.rawText).toContain('https://app.test/monitoreo/errores/5');
    expect(email).toBeUndefined();
    expect(req).toBeUndefined(); // requisito por omisión: EXIGIDO
    expect(repo.attachTicket).toHaveBeenCalledWith(5, 99);
    expect(gateway.notifyErrorsChanged).toHaveBeenCalled();
    expect(r.ticket).toEqual({ id: 99, code: 'TK-99' });
  });

  it('un grupo sin cliente acepta cliente y asignación elegidos en el diálogo', async () => {
    const { service, tickets, clientSystems } = make(baseRow({ client_id: null, system_id: null }));
    await service.createTicket(5, 11, { clientId: 8, systemId: 30 });
    expect(clientSystems.findByClientAndSystem).not.toHaveBeenCalled();
    expect(tickets.create.mock.calls[0][1]).toMatchObject({ clientId: 8, systemId: 30 });
  });

  it('un grupo con cliente rechaza otro cliente en el cuerpo (400)', async () => {
    const { service, repo, tickets } = make();
    await expect(service.createTicket(5, 11, { clientId: 8 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.reserveForTicket).not.toHaveBeenCalled();
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('si el alta exige sistema, el 400 «Elige el sistema afectado.» llega tal cual y el grupo vuelve a su estado', async () => {
    const { service, tickets, repo } = make(baseRow({ system_id: null }));
    const err = new BadRequestException({ code: 'BAD_INPUT', message: 'Elige el sistema afectado.' });
    tickets.create.mockRejectedValue(err);
    await expect(service.createTicket(5, 11, {})).rejects.toBe(err);
    expect(repo.restoreReservation).toHaveBeenCalledWith(5, {
      status: 'NUEVO',
      ticketId: null,
      ticketLinkedBy: null,
      ticketLinkedAt: null,
    });
    expect(repo.attachTicket).not.toHaveBeenCalled();
  });

  it('reserva antes de crear: si el UPDATE condicional no afecta filas responde 409 y no crea ticket', async () => {
    const { service, repo, tickets } = make();
    repo.reserveForTicket.mockResolvedValue(false);
    await expect(service.createTicket(5, 11, {})).rejects.toBeInstanceOf(ConflictException);
    expect(tickets.create).not.toHaveBeenCalled();
    expect(repo.restoreReservation).not.toHaveBeenCalled();
  });

  it('la reserva ocurre antes del alta del ticket', async () => {
    const { service, repo, tickets } = make();
    await service.createTicket(5, 11, {});
    expect(repo.reserveForTicket.mock.invocationCallOrder[0]).toBeLessThan(tickets.create.mock.invocationCallOrder[0]);
  });

  it('un fallo del alta deshace la reserva', async () => {
    const { service, tickets, repo, gateway } = make(baseRow({ status: 'RESUELTO' }));
    tickets.create.mockRejectedValue(new Error('db caída'));
    await expect(service.createTicket(5, 11, {})).rejects.toThrow('db caída');
    expect(repo.restoreReservation).toHaveBeenCalledWith(5, expect.objectContaining({ status: 'RESUELTO' }));
    expect(gateway.notifyErrorsChanged).not.toHaveBeenCalled();
  });

  it('un grupo que ya tiene ticket responde 409 sin reservar', async () => {
    const { service, repo } = make(baseRow({ status: 'CON_TICKET' }));
    await expect(service.createTicket(5, 11, {})).rejects.toBeInstanceOf(ConflictException);
    expect(repo.reserveForTicket).not.toHaveBeenCalled();
  });
});

describe('ErrorActionsService.resolve / reopen', () => {
  it('resolver guarda autor, fecha y nota y no crea ticket ni avisa al cliente', async () => {
    const { service, repo, tickets, gateway } = make();
    await service.resolve(5, 11, '  arreglado  ');
    expect(repo.markResolved).toHaveBeenCalledWith(5, 11, 'arreglado', expect.any(Date));
    expect(tickets.create).not.toHaveBeenCalled();
    expect(gateway.notifyErrorsChanged).toHaveBeenCalled();
  });

  it('resolver un grupo ya resuelto, o que otro resolvió a la vez, responde 409', async () => {
    const a = make(baseRow({ status: 'RESUELTO' }));
    await expect(a.service.resolve(5, 11)).rejects.toBeInstanceOf(ConflictException);
    const b = make();
    b.repo.markResolved.mockResolvedValue(false);
    await expect(b.service.resolve(5, 11)).rejects.toBeInstanceOf(ConflictException);
  });

  it('reabrir solo desde RESUELTO y deja reopen_reason «Reabierto a mano»', async () => {
    const ok = make(baseRow({ status: 'RESUELTO' }));
    await ok.service.reopen(5, 11);
    expect(ok.repo.markReopened).toHaveBeenCalledWith(5, expect.any(Date), 'Reabierto a mano');

    for (const status of ['NUEVO', 'CON_TICKET']) {
      const m = make(baseRow({ status }));
      await expect(m.service.reopen(5, 11)).rejects.toBeInstanceOf(ConflictException);
      expect(m.repo.markReopened).not.toHaveBeenCalled();
    }
  });
});
