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

/**
 * Comprueba el operador de rango por su FORMA (`and` de un `moreThanOrEqual`
 * y un `lessThan`), no por si las fechas aparecen en alguna serialización.
 *
 * Antes esta prueba hacía `JSON.stringify(...).toContain(fecha)`, y una
 * revisión detectó que eso no protege nada: `Between(from, to)` serializa
 * `{"_type":"between","_value":["<from>","<to>"]}`, con las mismas dos
 * fechas que `And(MoreThanOrEqual(from), LessThan(to))`. Si alguien revierte
 * al operador inclusivo — el bug concreto que esta tarea existe para evitar,
 * porque mete el primer instante del mes siguiente en dos informes — esa
 * prueba seguía en verde. Afirmar `type`/`value` de cada sub-operador sí
 * distingue un `and` de un `between`.
 */
function expectOpenRangeOperator(op: any, from: Date, to: Date) {
  expect(op.type).toBe('and');
  expect(op.value).toHaveLength(2);
  expect(op.value[0].type).toBe('moreThanOrEqual');
  expect(op.value[0].value).toEqual(from);
  expect(op.value[1].type).toBe('lessThan');
  expect(op.value[1].value).toEqual(to);
}

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
      expectOpenRangeOperator(typeormRepo.find.mock.calls[0][0].where.capturedAt, from, to);
    });
  });

  describe('countResolvedInPeriod', () => {
    it('cuenta por fecha de resolucion, no de alta', async () => {
      const { repo, typeormRepo } = makeRepo();
      const from = new Date('2026-08-01T05:00:00Z');
      const to = new Date('2026-09-01T05:00:00Z');
      await repo.countResolvedInPeriod(7, from, to);
      // Objeto literal completo: si el `where` llevara también `capturedAt`
      // (mezclando el criterio de alta con el de resolución), esta llamada
      // ya no calzaría con lo esperado y la prueba fallaría.
      expect(typeormRepo.count).toHaveBeenCalledWith({
        where: { clientId: 7, resolvedAt: expect.anything() },
      });
      expectOpenRangeOperator(typeormRepo.count.mock.calls[0][0].where.resolvedAt, from, to);
    });
  });
});
