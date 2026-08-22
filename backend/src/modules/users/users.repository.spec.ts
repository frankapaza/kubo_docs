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
