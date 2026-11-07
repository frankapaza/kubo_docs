import { ClientSystemsService } from './client-systems.service';

const ASIGNACION = { id: 50, clientId: 7, systemId: 3, isActive: 1 };

const makeService = () => {
  const repo = {
    listByClient: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(ASIGNACION),
    findByClientAndSystem: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve({ id: 51, ...d })),
    update: jest.fn().mockImplementation((id, d) => Promise.resolve({ id, ...d })),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const clients = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 7 }) };
  const systems = { findById: jest.fn().mockResolvedValue({ id: 3, name: 'ERP Core', isActive: 1 }) };
  const tickets = { countByClientSystem: jest.fn().mockResolvedValue(0) };
  return {
    service: new ClientSystemsService(repo as any, clients as any, systems as any, tickets as any),
    repo,
    clients,
    systems,
    tickets,
  };
};

describe('asignar un sistema a un cliente', () => {
  it('escribe la pareja y nada mas: ningun nombre', async () => {
    const { service, repo } = makeService();
    await service.create(7, { systemId: 3 } as any);
    expect(repo.create).toHaveBeenCalledWith({ clientId: 7, systemId: 3, isActive: 1 });
  });

  it('un cliente que no existe da 404 y no asigna nada', async () => {
    const { service, clients, repo } = makeService();
    clients.findByIdOrFail.mockRejectedValue(new Error('Cliente no encontrado'));
    await expect(service.create(99, { systemId: 3 } as any)).rejects.toThrow('Cliente no encontrado');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('un sistema que no esta en el catalogo da 404', async () => {
    const { service, systems, repo } = makeService();
    systems.findById.mockResolvedValue(null);
    await expect(service.create(7, { systemId: 99 } as any)).rejects.toThrow(
      'Sistema no encontrado',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('un sistema retirado del catalogo no se puede asignar a nadie mas', async () => {
    const { service, systems, repo } = makeService();
    systems.findById.mockResolvedValue({ id: 3, name: 'ERP Core', isActive: 0 });
    await expect(service.create(7, { systemId: 3 } as any)).rejects.toThrow(
      'Este sistema está retirado del catálogo y ya no se puede asignar.',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('asignar dos veces el mismo producto se rechaza', async () => {
    const { service, repo } = makeService();
    repo.findByClientAndSystem.mockResolvedValue(ASIGNACION);
    await expect(service.create(7, { systemId: 3 } as any)).rejects.toThrow(
      'Este cliente ya tiene asignado «ERP Core».',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('desactivar una asignacion no toca ningun ticket', async () => {
    const { service, repo, tickets } = makeService();
    tickets.countByClientSystem.mockResolvedValue(12);
    await service.update(50, { isActive: false } as any);
    expect(repo.update).toHaveBeenCalledWith(50, { isActive: 0 });
    expect(tickets.countByClientSystem).not.toHaveBeenCalled();
  });

  it('quitar una asignacion con tickets detras se rechaza y no borra nada', async () => {
    const { service, repo, tickets } = makeService();
    tickets.countByClientSystem.mockResolvedValue(1);
    await expect(service.remove(50)).rejects.toThrow(
      'Este cliente tiene tickets de este sistema. Desactívalo en lugar de quitarlo.',
    );
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('quitar una asignacion recien puesta, sin tickets, si se permite', async () => {
    const { service, repo, tickets } = makeService();
    await service.remove(50);
    // Por el id de la ASIGNACION, que es lo que el ticket guarda en su
    // `system_id`, no por el del producto del catalogo.
    expect(tickets.countByClientSystem).toHaveBeenCalledWith(50);
    expect(repo.remove).toHaveBeenCalledWith(50);
  });

  it('una asignacion que no existe da 404 al quitarla', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.remove(99)).rejects.toThrow('Sistema no encontrado');
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
