import { BadRequestException, NotFoundException } from '@nestjs/common';

import { TicketsService } from './tickets.service';
import { Ticket } from './entities/ticket.entity';
import { ClientUser } from '../portal/entities/client-user.entity';
import { Project } from '../projects/entities/project.entity';

/**
 * Cambiar el cliente de un ticket. Arnés propio, como el de archivar.
 * Cliente viejo 4 (Cobros Seguros), nuevo 8 (FIDELITY).
 */
const makeService = (inicial: Partial<Ticket> = {}) => {
  let ticket = {
    id: 9, status: 'NUEVO', clientId: 4, systemId: 11, projectId: 30, createdByClientUserId: 40, ...inicial,
  } as Ticket;

  const clientUsers: Record<number, Partial<ClientUser>> = {
    40: { id: 40, clientId: 4, isActive: 1 },
    50: { id: 50, clientId: 8, isActive: 1 },
    51: { id: 51, clientId: 8, isActive: 0 },
  };
  const projects: Record<number, Partial<Project>> = { 30: { id: 30, clientId: 4 }, 31: { id: 31, clientId: 8 } };

  const ticketRepo = {
    update: jest.fn().mockImplementation((_id: number, patch: Partial<Ticket>) => {
      ticket = { ...ticket, ...patch };
      return Promise.resolve({ affected: 1 });
    }),
    findOneBy: jest.fn().mockImplementation(() => Promise.resolve(ticket)),
  };
  const manager = {
    getRepository: (e: unknown) => {
      if (e === Ticket) return ticketRepo;
      if (e === ClientUser) return { findOneBy: ({ id }: { id: number }) => Promise.resolve(clientUsers[id] ?? null) };
      if (e === Project) return { findOneBy: ({ id }: { id: number }) => Promise.resolve(projects[id] ?? null) };
      throw new Error('repo inesperado');
    },
  };
  const repo = {
    findById: jest.fn().mockImplementation(() => Promise.resolve(ticket)),
    runInTransaction: jest.fn().mockImplementation((work: (m: unknown) => unknown) => work(manager)),
  };
  const clients = {
    findByIdOrFail: jest.fn().mockImplementation((id: number) =>
      id === 8 || id === 4 ? Promise.resolve({ id }) : Promise.reject(new NotFoundException()),
    ),
  };
  const systems = {
    listActiveByClient: jest.fn().mockImplementation((id: number) =>
      Promise.resolve(id === 8 ? [{ id: 20 }, { id: 21 }] : [{ id: 11 }]),
    ),
  };

  const service = new TicketsService(repo as any, {} as any, {} as any, clients as any, systems as any);
  return { service, ticketRepo, current: () => ticket };
};

describe('cambiar el cliente de un ticket', () => {
  it('lo pasa al cliente nuevo con su sistema y el usuario que recibe los avisos', async () => {
    const { service, current } = makeService();
    await service.changeClient(9, { clientId: 8, systemId: 20, clientUserId: 50 });
    expect(current()).toMatchObject({ clientId: 8, systemId: 20, createdByClientUserId: 50 });
  });

  it('sin usuario nuevo, no deja como autor a uno del cliente anterior', async () => {
    const { service, current } = makeService();
    await service.changeClient(9, { clientId: 8, systemId: 20 });
    expect(current().createdByClientUserId).toBeNull();
  });

  it('suelta el proyecto si era del cliente anterior', async () => {
    const { service, current } = makeService();
    await service.changeClient(9, { clientId: 8, systemId: 20 });
    expect(current().projectId).toBeNull();
  });

  it('conserva el proyecto si ya era del cliente nuevo', async () => {
    const { service, current } = makeService({ projectId: 31 });
    await service.changeClient(9, { clientId: 8, systemId: 20 });
    expect(current().projectId).toBe(31);
  });

  it('un sistema que no es del cliente nuevo responde 400 sin tocar nada', async () => {
    const { service, ticketRepo } = makeService();
    await expect(service.changeClient(9, { clientId: 8, systemId: 11 })).rejects.toBeInstanceOf(BadRequestException);
    expect(ticketRepo.update).not.toHaveBeenCalled();
  });

  it('si el cliente nuevo tiene sistemas, hay que elegir uno', async () => {
    const { service } = makeService();
    await expect(service.changeClient(9, { clientId: 8 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un usuario de otro cliente o inactivo responde 400', async () => {
    const { service, ticketRepo } = makeService();
    await expect(service.changeClient(9, { clientId: 8, systemId: 20, clientUserId: 40 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.changeClient(9, { clientId: 8, systemId: 20, clientUserId: 51 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ticketRepo.update).not.toHaveBeenCalled();
  });

  it('un cliente inexistente responde 404', async () => {
    const { service } = makeService();
    await expect(service.changeClient(9, { clientId: 99, systemId: 20 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
