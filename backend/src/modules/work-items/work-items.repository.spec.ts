import { WorkItemsRepository } from './work-items.repository';

/**
 * `PortalRequirementsService.spec.ts` prueba el servicio con un doble de
 * `WorkItemsRepository` que ya trae los dos filtros de empresa/origen
 * cableados dentro de la implementación del doble. Eso es correcto para
 * probar el servicio, pero deja un hueco real: ningún test ejercita el
 * `WorkItemsRepository` de verdad, así que si mañana alguien escribe
 * `where: { clientId }` en `listPortalRequirements` (perdiendo `origin`), o
 * `where: { id, clientId }` en `findPortalRequirement` (mismo problema), las
 * pruebas del servicio siguen en verde — el doble no lo detecta porque no
 * ejecuta ese código — y el portal enseñaría trabajo interno o de otra
 * empresa. Este archivo cierra ese hueco afirmando los argumentos exactos
 * que cada método pasa al `Repository` de TypeORM, con el mismo estilo que
 * `portal/client-users.repository.spec.ts`.
 */
const makeRepo = () => {
  const typeormRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const eventsTypeormRepo = {
    findOne: jest.fn().mockResolvedValue(null),
  };
  // `dataSource` no lo usa ninguno de los tres métodos bajo prueba
  // (`runInTransaction` es el único que lo toca); un valor cualquiera basta.
  const repo = new WorkItemsRepository(typeormRepo as any, eventsTypeormRepo as any, {} as any);
  return { repo, typeormRepo, eventsTypeormRepo };
};

/**
 * Mismo helper y mismo motivo que en `tickets.repository.spec.ts`: afirma
 * que el operador es un `and` de `moreThanOrEqual` + `lessThan`, por su
 * forma, no por si las fechas aparecen en su serialización.
 */
function expectOpenRangeOperator(op: any, from: Date, to: Date) {
  expect(op.type).toBe('and');
  expect(op.value).toHaveLength(2);
  expect(op.value[0].type).toBe('moreThanOrEqual');
  expect(op.value[0].value).toEqual(from);
  expect(op.value[1].type).toBe('lessThan');
  expect(op.value[1].value).toEqual(to);
}

describe('WorkItemsRepository', () => {
  describe('listPortalRequirements', () => {
    it('filtra por clientId y origin PORTAL a la vez, en el mismo where', async () => {
      const { repo, typeormRepo } = makeRepo();
      await repo.listPortalRequirements(7);
      expect(typeormRepo.find).toHaveBeenCalledWith({
        where: { clientId: 7, origin: 'PORTAL' },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
    });
  });

  describe('listPortalRequirementsInPeriod', () => {
    it('lleva empresa, origen y rango, los tres en el mismo where', async () => {
      const { repo, typeormRepo } = makeRepo();
      const from = new Date('2026-08-01T05:00:00Z');
      const to = new Date('2026-09-01T05:00:00Z');
      await repo.listPortalRequirementsInPeriod(7, from, to);
      expect(typeormRepo.find).toHaveBeenCalledWith({
        where: { clientId: 7, origin: 'PORTAL', createdAt: expect.anything() },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      // Forma del operador, no solo las fechas: ver el comentario de
      // `expectOpenRangeOperator` en tickets.repository.spec.ts — un
      // `Between` serializa las mismas dos fechas que este `And`, así que
      // una prueba que solo buscara las fechas no distinguiría uno de otro.
      expectOpenRangeOperator(typeormRepo.find.mock.calls[0][0].where.createdAt, from, to);
    });
  });

  describe('findPortalRequirement', () => {
    it('filtra por id, clientId y origin PORTAL a la vez, en el mismo where', async () => {
      const { repo, typeormRepo } = makeRepo();
      await repo.findPortalRequirement(7, 3);
      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: { id: 3, clientId: 7, origin: 'PORTAL' },
      });
    });
  });

  describe('lastRejectionReason', () => {
    it('busca el evento REJECTED de ese ítem, el más reciente primero', async () => {
      const { repo, eventsTypeormRepo } = makeRepo();
      await repo.lastRejectionReason(3);
      // El desempate por `id` es lo que hace determinista "el más reciente"
      // cuando dos rechazos caen en el mismo segundo de `createdAt`: sin él,
      // dos filas con igual marca de tiempo dejarían el orden — y por tanto
      // qué motivo se muestra — a criterio de la base, no del código.
      expect(eventsTypeormRepo.findOne).toHaveBeenCalledWith({
        where: { workItemId: 3, type: 'REJECTED' },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
    });
  });
});
