import { UsersRepository } from './users.repository';

/**
 * Tanda de cierre: `findByEmail` normaliza el correo a minúsculas desde
 * siempre, pero no reescribía el dominio a su forma codificada (punycode) --
 * la misma corrección que `ClientUsersRepository.findByEmail`, y por el mismo
 * motivo (ver el comentario de esa función): el cruce de dominios del correo
 * entrante ya deja pasar a un miembro del personal con un dominio
 * internacionalizado, pero esta búsqueda, sin normalizar, seguía sin
 * reconocerlo.
 */
const makeRepo = () => {
  const typeormRepo = {
    create: jest.fn((data: unknown) => data),
    save: jest.fn((entity: unknown) => Promise.resolve({ id: 1, ...(entity as object) })),
    update: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const repo = new UsersRepository(typeormRepo as any);
  return { repo, typeormRepo };
};

describe('UsersRepository.findByEmail', () => {
  it('recorta y pone en minúsculas antes de buscar', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.findByEmail('  Tecnico@Kuboti.COM  ');
    expect(typeormRepo.findOne).toHaveBeenCalledWith({ where: { email: 'tecnico@kuboti.com' } });
  });

  it('busca por el dominio ya normalizado a su forma codificada, aunque llegue en caracteres nacionales', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.findByEmail('tecnico@пример.com');
    expect(typeormRepo.findOne).toHaveBeenCalledWith({
      where: { email: 'tecnico@xn--e1afmkfd.com' },
    });
  });
});

/**
 * Corrección posterior a la tanda de cierre: `create`/`update` guardaban el
 * correo tal cual, sin normalizar -- mismo defecto que tenía
 * `ClientUsersRepository` antes de su propia corrección, y con el mismo
 * síntoma: un miembro del personal con el correo mal capitalizado, con
 * espacios, o con un dominio internacionalizado quedaba guardado así, y
 * `findByEmail` (que sí normaliza) nunca volvía a encontrarlo -- el inicio de
 * sesión fallaba siempre, sin ningún error que lo explicara.
 */
describe('UsersRepository.create/update', () => {
  it('normaliza el correo a minusculas al crear, aunque llegue con mayusculas y espacios', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.create({ email: '  Nuevo.Tecnico@Kuboti.COM  ' } as any);
    expect(typeormRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'nuevo.tecnico@kuboti.com' }),
    );
  });

  it('normaliza el dominio internacionalizado a su forma codificada al crear', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.create({ email: 'tecnico@пример.com' } as any);
    expect(typeormRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'tecnico@xn--e1afmkfd.com' }),
    );
  });

  it('normaliza el correo al actualizar', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.update(1, { email: '  OTRO@Kuboti.com ' } as any);
    expect(typeormRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ email: 'otro@kuboti.com' }));
  });

  it('un update sin email no toca ni añade esa clave', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.update(1, { role: 'ADMIN' } as any);
    expect(typeormRepo.update).toHaveBeenCalledWith(1, { role: 'ADMIN' });
  });

  it('no muta el objeto que le pasó el llamador', async () => {
    const { repo } = makeRepo();
    const data = { email: 'Alguien@Kuboti.com' };
    await repo.create(data as any);
    expect(data.email).toBe('Alguien@Kuboti.com');
  });
});
