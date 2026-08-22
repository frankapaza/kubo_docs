import { TicketsRepository } from './tickets.repository';

/**
 * Estas dos consultas alimentan el informe mensual del portal (tarea 4 de
 * "informe-mensual-cliente"). Ninguna puede reutilizar `list(filters)`: ese
 * método monta el filtro de empresa con `if (filters.clientId)`, así que un
 * valor falsy (por ejemplo `0`, aunque no debería llegar así) haría
 * desaparecer el `WHERE` y devolvería tickets de todas las empresas — una
 * fuga de visibilidad entre clientes. Aquí el `where` es fijo, sin
 * condicional, con el mismo estilo que `work-items.repository.spec.ts`. Ese
 * patrón importa más aquí que en ningún sitio: si mañana alguien borra
 * `clientId` del `where`, ninguna prueba de servicio lo detectaría, porque
 * los dobles del servicio no ejecutan esta consulta.
 */
const makeRepo = () => {
  const typeormRepo = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  // `dataSource` no lo usa ninguno de los dos métodos bajo prueba
  // (solo `runInTransaction` lo toca); un valor cualquiera basta.
  const repo = new TicketsRepository(typeormRepo as any, {} as any);
  return { repo, typeormRepo };
};

describe('TicketsRepository', () => {
  describe('listForClientPeriod', () => {
    it('acota por empresa y por el intervalo [from, to)', async () => {
      const { repo, typeormRepo } = makeRepo();
      const from = new Date('2026-08-01T05:00:00Z');
      const to = new Date('2026-09-01T05:00:00Z');
      await repo.listForClientPeriod(7, from, to);
      expect(typeormRepo.find).toHaveBeenCalledWith({
        where: { clientId: 7, capturedAt: expect.anything() },
        order: { capturedAt: 'ASC', id: 'ASC' },
      });
      // El operador de rango se comprueba aparte, por su forma: no puede ser
      // `Between`, que es inclusivo por los dos extremos y metería en el
      // informe de agosto lo ocurrido en el primer instante de septiembre.
      // `FindOperator` no define `toString`, así que se serializa con
      // `JSON.stringify` (expone `_value` recursivamente) en lugar de
      // `String(...)`, que solo daría "[object Object]".
      const arg = typeormRepo.find.mock.calls[0][0];
      expect(JSON.stringify(arg.where.capturedAt)).toContain('2026-08-01T05:00:00');
      expect(JSON.stringify(arg.where.capturedAt)).toContain('2026-09-01T05:00:00');
    });
  });

  describe('countResolvedInPeriod', () => {
    it('cuenta por fecha de resolucion, no de alta', async () => {
      const { repo, typeormRepo } = makeRepo();
      await repo.countResolvedInPeriod(
        7,
        new Date('2026-08-01T05:00:00Z'),
        new Date('2026-09-01T05:00:00Z'),
      );
      const arg = typeormRepo.count.mock.calls[0][0];
      expect(arg.where.clientId).toBe(7);
      expect(arg.where.resolvedAt).toBeDefined();
      expect(arg.where.capturedAt).toBeUndefined();
    });
  });
});
