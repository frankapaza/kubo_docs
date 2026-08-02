import { ClientUsersRepository } from './client-users.repository';

/**
 * `findByEmail` ya normalizaba el correo al leer. Este archivo cubre la otra
 * mitad, que era el hallazgo de revisión pendiente: `create` y `update` deben
 * normalizar también al escribir, dentro del propio repositorio, para que la
 * garantía "un correo, una fila" no dependa de que cada consumidor futuro se
 * acuerde de hacerlo por su cuenta.
 */
const makeRepo = () => {
  const typeormRepo = {
    create: jest.fn((data: unknown) => data),
    save: jest.fn((entity: unknown) => Promise.resolve({ id: 1, ...(entity as object) })),
    update: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const repo = new ClientUsersRepository(typeormRepo as any);
  return { repo, typeormRepo };
};

describe('ClientUsersRepository', () => {
  it('normaliza el correo a minusculas al crear, aunque llegue con mayusculas y espacios', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.create({ email: '  Nuevo.Usuario@Empresa.COM  ', clientId: 1 } as any);
    expect(typeormRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'nuevo.usuario@empresa.com' }),
    );
  });

  it('normaliza el correo a minusculas al actualizar', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.update(1, { email: '  OTRO@Empresa.com ' } as any);
    expect(typeormRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ email: 'otro@empresa.com' }));
  });

  it('un update sin email no toca ni añade esa clave', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.update(1, { fullName: 'Nombre Nuevo' } as any);
    expect(typeormRepo.update).toHaveBeenCalledWith(1, { fullName: 'Nombre Nuevo' });
  });

  it('no muta el objeto que le pasó el llamador', async () => {
    const { repo } = makeRepo();
    const data = { email: 'Alguien@Empresa.com' };
    await repo.create(data as any);
    expect(data.email).toBe('Alguien@Empresa.com');
  });
});
