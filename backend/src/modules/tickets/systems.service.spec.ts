import { SystemsService } from './systems.service';

const makeService = () => {
  const repo = {
    list: jest.fn().mockResolvedValue([]),
    listActive: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 3, name: 'ERP Core', isActive: 1 }),
    findByName: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve({ id: 9, ...d })),
    update: jest.fn().mockImplementation((id, d) => Promise.resolve({ id, ...d })),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const assignments = { countBySystem: jest.fn().mockResolvedValue(0) };
  return { service: new SystemsService(repo as any, assignments as any), repo, assignments };
};

describe('el catalogo de sistemas', () => {
  it('recorta el nombre al darlo de alta', async () => {
    const { service, repo } = makeService();
    await service.create({ name: '  ERP Core  ' } as any);
    expect(repo.create).toHaveBeenCalledWith({ name: 'ERP Core', isActive: 1 });
  });

  it('un nombre repetido se rechaza, y no distingue mayusculas', async () => {
    const { service, repo } = makeService();
    repo.findByName.mockResolvedValue({ id: 3, name: 'ERP Core' });
    await expect(service.create({ name: 'erp core' } as any)).rejects.toThrow(
      'Ya existe un sistema llamado «erp core» en el catálogo.',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('renombrarse a si mismo no es un duplicado', async () => {
    const { service, repo } = makeService();
    // `findByName` devuelve el mismo id que se esta editando: no hay choque.
    repo.findByName.mockResolvedValue({ id: 3, name: 'ERP Core' });
    await expect(service.update(3, { name: 'ERP CORE' } as any)).resolves.toBeDefined();
  });

  it('renombrar a un nombre que ya tiene otro sistema se rechaza', async () => {
    const { service, repo } = makeService();
    repo.findByName.mockResolvedValue({ id: 4, name: 'Cobranza' });
    await expect(service.update(3, { name: 'cobranza' } as any)).rejects.toThrow(
      'Ya existe un sistema llamado «cobranza» en el catálogo.',
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  // Por `sameId` y no por `===`: el id que viene de la base es la cadena "3".
  it('el duplicado se compara por valor aunque la base devuelva el id como cadena', async () => {
    const { service, repo } = makeService();
    repo.findByName.mockResolvedValue({ id: '3', name: 'ERP Core' });
    await expect(service.update(3, { name: 'ERP Core' } as any)).resolves.toBeDefined();
  });

  it('retirar del catalogo no toca ninguna asignacion', async () => {
    const { service, repo, assignments } = makeService();
    assignments.countBySystem.mockResolvedValue(4);
    await service.update(3, { isActive: false } as any);
    expect(repo.update).toHaveBeenCalledWith(3, { isActive: 0 });
    // Un producto retirado deja de poder asignarse, pero los cuatro clientes
    // que ya lo tienen siguen abriendo tickets sobre el (decision 3).
    expect(assignments.countBySystem).not.toHaveBeenCalled();
  });

  it('borrar un sistema asignado a alguien se rechaza y no borra nada', async () => {
    const { service, repo, assignments } = makeService();
    assignments.countBySystem.mockResolvedValue(1);
    await expect(service.remove(3)).rejects.toThrow(
      'Este sistema está asignado a algún cliente. Retíralo del catálogo en lugar de borrarlo.',
    );
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('borrar un sistema que nadie tiene si se permite', async () => {
    const { service, repo } = makeService();
    await service.remove(3);
    expect(repo.remove).toHaveBeenCalledWith(3);
  });

  it('un sistema que no existe da 404 al editarlo', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.update(99, { name: 'X' } as any)).rejects.toThrow('Sistema no encontrado');
  });

  it('un sistema que no existe da 404 al borrarlo', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.remove(99)).rejects.toThrow('Sistema no encontrado');
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
