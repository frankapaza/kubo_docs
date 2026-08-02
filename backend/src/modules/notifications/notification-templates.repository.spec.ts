import { NotificationTemplatesRepository } from './notification-templates.repository';

/**
 * `findActive` es donde vive "desactivar una plantilla apaga ese aviso": el
 * filtro `isActive` tiene que ir en la propia consulta, no confiarse a que
 * quien la llame descarte la fila después.
 */
const makeRepo = () => {
  const typeormRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: 1 }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const repo = new NotificationTemplatesRepository(typeormRepo as any);
  return { repo, typeormRepo };
};

describe('NotificationTemplatesRepository', () => {
  it('findActive filtra por triggerKey, audience e isActive=1 en la propia consulta', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.findActive('TICKET_CREATED', 'CLIENT');
    expect(typeormRepo.findOne).toHaveBeenCalledWith({
      where: { triggerKey: 'TICKET_CREATED', audience: 'CLIENT', isActive: 1 },
    });
  });

  it('findById busca por id sin ningún otro filtro', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.findById(1);
    expect(typeormRepo.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('findAll no filtra por isActive: el panel debe poder ver también las desactivadas', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.findAll();
    const [args] = typeormRepo.find.mock.calls[0];
    expect(args?.where).toBeUndefined();
  });

  it('update escribe el parche y relee la fila por id', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.update(1, { subject: 'Nuevo asunto' } as any);
    expect(typeormRepo.update).toHaveBeenCalledWith(1, { subject: 'Nuevo asunto' });
    expect(typeormRepo.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('update devuelve null si la fila no existe tras el update', async () => {
    const { repo, typeormRepo } = makeRepo();
    typeormRepo.findOne.mockResolvedValueOnce(null);
    const result = await repo.update(999, { subject: 'x' } as any);
    expect(result).toBeNull();
  });
});
