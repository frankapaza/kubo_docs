import { ClientSystemsRepository } from './client-systems.repository';

/**
 * Lo que ninguna prueba del servicio puede ver: **dónde** cuentan y filtran las
 * consultas. Los dobles del servicio no ejecutan la consulta, así que un
 * `where` equivocado aquí pasaría en verde allí (mismo razonamiento que el
 * docblock de `tickets.repository.spec.ts`).
 */
const makeRepo = () => {
  const typeormRepo = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findOne: jest.fn().mockResolvedValue(null),
  };
  return { repo: new ClientSystemsRepository(typeormRepo as any), typeormRepo };
};

describe('ClientSystemsRepository', () => {
  it('countBySystem cuenta las asignaciones activas Y las inactivas', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.countBySystem(3);
    // Sin `isActive` en el `where`: un producto con historia no se borra, se
    // retira (decision 3 del diseno).
    expect(typeormRepo.count).toHaveBeenCalledWith({ where: { systemId: 3 } });
  });
});
