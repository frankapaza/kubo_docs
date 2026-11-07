import { ClientSystemsRepository } from './client-systems.repository';

/**
 * Lo que ninguna prueba del servicio puede ver: **dónde** cuentan y filtran las
 * consultas. Los dobles del servicio no ejecutan la consulta, así que un
 * `where` equivocado aquí pasaría en verde allí (mismo razonamiento que el
 * docblock de `tickets.repository.spec.ts`).
 */

/**
 * El doble devuelve `qb` en cada eslabon y **solo declara los metodos que
 * estas consultas deben usar**. Eso es deliberado: si alguien cambia el
 * `innerJoin` por un `leftJoin`, la prueba revienta con «qb.leftJoin is not a
 * function» en vez de pasar en verde -- y ese cambio es exactamente la
 * regresion que importa, porque un LEFT JOIN deja entrar las filas que la
 * migracion 029 marco, sin nombre de catalogo que ensenar.
 */
const makeQueryBuilder = () => {
  const qb: any = {};
  for (const m of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'orderBy']) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  return qb;
};

/** Todas las condiciones de la consulta, en una sola cadena. */
const condiciones = (qb: any) =>
  [...qb.where.mock.calls, ...qb.andWhere.mock.calls].map((c) => String(c[0])).join(' ');

const makeRepo = () => {
  const qb = makeQueryBuilder();
  const typeormRepo = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
  return { repo: new ClientSystemsRepository(typeormRepo as any), typeormRepo, qb };
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

describe('la lista de asignaciones viene unida al catalogo', () => {
  it('listByClient se une por dentro y acota por cliente', async () => {
    const { repo, qb } = makeRepo();
    await repo.listByClient(7);
    expect(qb.innerJoin).toHaveBeenCalled();
    expect(condiciones(qb)).toContain('client_id');
    expect(condiciones(qb)).not.toContain('is_active');
  });

  it('listActiveByClient ademas exige que la asignacion este activa', async () => {
    const { repo, qb } = makeRepo();
    await repo.listActiveByClient(7);
    expect(qb.innerJoin).toHaveBeenCalled();
    expect(condiciones(qb)).toContain('client_id');
    expect(condiciones(qb)).toContain('is_active');
  });

  // `getRawMany` devuelve los bigint como cadena y el tinyint como numero o
  // cadena segun el driver: la vista los entrega ya normalizados.
  it('la vista sale con los ids y el estado como numeros y el nombre del catalogo', async () => {
    const { repo, qb } = makeRepo();
    qb.getRawMany.mockResolvedValue([
      { id: '50', clientId: '7', systemId: '3', name: 'ERP Core', isActive: '1' },
    ]);
    await expect(repo.listByClient(7)).resolves.toEqual([
      { id: 50, clientId: 7, systemId: 3, name: 'ERP Core', isActive: 1 },
    ]);
  });
});
