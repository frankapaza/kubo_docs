import { EntityManager, IsNull, MoreThan, Repository } from 'typeorm';

import { ClientUserInvitationsRepository } from './client-user-invitations.repository';
import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { fingerprintInvitationSecret, generateInvitationSecret } from './domain/invitation-secret';

/**
 * Doble del `Repository` de TypeORM que GUARDA lo que le mandan escribir, para
 * poder inspeccionarlo después. Es la única forma de comprobar la promesa
 * central de esta funcionalidad —que el secreto en claro no llega a la base—
 * sin levantar MySQL.
 */
function repoDoble() {
  const guardado: Array<Partial<ClientUserInvitation>> = [];
  const actualizado: Array<[unknown, Partial<ClientUserInvitation>]> = [];
  const repo = {
    guardado,
    actualizado,
    create: jest.fn((d: Partial<ClientUserInvitation>) => d),
    save: jest.fn(async (d: Partial<ClientUserInvitation>) => {
      guardado.push(d);
      return { id: 1, ...d } as ClientUserInvitation;
    }),
    update: jest.fn(async (where: unknown, patch: Partial<ClientUserInvitation>) => {
      actualizado.push([where, patch]);
      return { affected: 1 };
    }),
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
  };
  return repo;
}

function makeRepo() {
  const orm = repoDoble();
  const repo = new ClientUserInvitationsRepository(
    orm as unknown as Repository<ClientUserInvitation>,
    { transaction: jest.fn() } as any,
  );
  return { repo, orm };
}

describe('ClientUserInvitationsRepository', () => {
  /**
   * LA PRUEBA QUE SOSTIENE LA DECISIÓN 3 DE LA SPEC. No es un comentario que
   * promete que el secreto no se guarda: es la comprobación de que ningún
   * campo de la fila que se escribe contiene el secreto en claro, ni entero ni
   * como subcadena, ni en la clave ni en el valor.
   */
  it('el secreto en claro no aparece por ningún lado en la fila que se escribe', async () => {
    const { repo, orm } = makeRepo();
    const secreto = generateInvitationSecret();

    await repo.create({
      clientId: 7,
      email: 'Ana@Kuboti.com ',
      fullName: 'Ana',
      secretFingerprint: fingerprintInvitationSecret(secreto),
      invitedByClientUserId: 3,
      expiresAt: new Date('2026-09-02T15:00:00.000Z'),
    });

    expect(orm.guardado).toHaveLength(1);
    expect(JSON.stringify(orm.guardado[0])).not.toContain(secreto);
  });

  it('guarda la huella, y la huella es la del secreto', async () => {
    const { repo, orm } = makeRepo();
    const secreto = generateInvitationSecret();

    await repo.create({
      clientId: 7,
      email: 'ana@kuboti.com',
      fullName: 'Ana',
      secretFingerprint: fingerprintInvitationSecret(secreto),
      invitedByClientUserId: 3,
      expiresAt: new Date('2026-09-02T15:00:00.000Z'),
    });

    expect(orm.guardado[0].secretFingerprint).toBe(fingerprintInvitationSecret(secreto));
  });

  /**
   * La misma normalización, en el mismo orden, en los dos lados de cualquier
   * comparación por correo: si al escribir se guardara `Ana@Kuboti.com` y al
   * buscar se buscara `ana@kuboti.com`, la invitación existiría y nadie la
   * encontraría nunca.
   */
  it('normaliza el correo al escribir: minúsculas y recortado', async () => {
    const { repo, orm } = makeRepo();
    await repo.create({
      clientId: 7,
      email: '  Ana@Kuboti.COM ',
      fullName: 'Ana',
      secretFingerprint: 'f'.repeat(64),
      invitedByClientUserId: 3,
      expiresAt: new Date('2026-09-02T15:00:00.000Z'),
    });
    expect(orm.guardado[0].email).toBe('ana@kuboti.com');
  });

  it('normaliza el correo también al buscar una invitación viva', async () => {
    const { repo, orm } = makeRepo();
    await repo.findLiveByEmail('  Ana@Kuboti.COM ', new Date('2026-08-26T15:00:00.000Z'));
    expect(orm.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: 'ana@kuboti.com' }) }),
    );
  });

  /**
   * LOS TRES FILTROS QUE IMPIDEN DEVOLVER UNA INVITACIÓN GASTADA, y que hasta
   * ahora no sostenía ninguna prueba: quitarlos de la consulta no mataba nada.
   *
   * Van en el `WHERE` a propósito, no en un `if` posterior, así que la prueba
   * tiene que mirar el `WHERE`. Se compara el objeto ENTERO y no con
   * `objectContaining`: así muere igual quien borre un filtro y quien afloje
   * uno —cambiar `MoreThan(now)` por `MoreThan(new Date(0))` devolvería
   * invitaciones caducadas y pasaría cualquier comprobación parcial—.
   */
  it('buscar una invitación viva filtra sin usar, sin revocar y sin caducar, en el WHERE', async () => {
    const { repo, orm } = makeRepo();
    const ahora = new Date('2026-08-26T15:00:00.000Z');

    await repo.findLiveByEmail('ana@kuboti.com', ahora);

    expect(orm.findOne).toHaveBeenCalledWith({
      where: {
        email: 'ana@kuboti.com',
        usedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(ahora),
      },
    });
  });

  it('buscar una invitación viva devuelve lo que responde la consulta, sin filtrar después', async () => {
    const { repo, orm } = makeRepo();
    const fila = { id: 4, email: 'ana@kuboti.com' } as ClientUserInvitation;
    orm.findOne.mockResolvedValueOnce(fila as never);

    await expect(
      repo.findLiveByEmail('ana@kuboti.com', new Date('2026-08-26T15:00:00.000Z')),
    ).resolves.toBe(fila);
  });

  /**
   * `listPendingByClient` no tenía NI UNA prueba. Dos cosas que fijar aquí, y
   * la primera es de seguridad: el `clientId` va en el `WHERE`. Sin él, la
   * pantalla de invitaciones pendientes de una empresa listaría las de todas
   * —correos y nombres completos de los clientes de la competencia—, que es la
   * fuga entre empresas por la puerta de atrás. La segunda son los tres
   * filtros de vida, los mismos de arriba.
   */
  it('listar las pendientes va acotado a la empresa y a las que siguen vivas', async () => {
    const { repo, orm } = makeRepo();
    const ahora = new Date('2026-08-26T15:00:00.000Z');

    await repo.listPendingByClient(7, ahora);

    expect(orm.find).toHaveBeenCalledWith({
      where: {
        clientId: 7,
        usedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(ahora),
      },
      order: { createdAt: 'DESC' },
    });
  });

  it('listar las pendientes las da de la más reciente a la más antigua', async () => {
    const { repo, orm } = makeRepo();
    const filas = [{ id: 2 }, { id: 1 }] as ClientUserInvitation[];
    orm.find.mockResolvedValueOnce(filas as never);

    await expect(
      repo.listPendingByClient(7, new Date('2026-08-26T15:00:00.000Z')),
    ).resolves.toBe(filas);
    expect(orm.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { createdAt: 'DESC' } }),
    );
  });

  /**
   * `findPendingByIdForClient` tampoco tenía ninguna, y es la peor de las dos
   * para quedarse sin red: el `id` viene de la URL, así que sin el `clientId`
   * en el `WHERE` cualquier administrador de cualquier empresa lee —y luego
   * revoca o reenvía— la invitación de otra empresa probando números. Que la
   * comprobación no esté en un `if` posterior es justo lo que hace que el
   * `null` se convierta en 404 y no en un 403 que confirmaría que ese id
   * existe en otra empresa.
   */
  it('buscar una pendiente por id va acotado a la empresa, no solo al id', async () => {
    const { repo, orm } = makeRepo();

    await repo.findPendingByIdForClient(42, 7);

    expect(orm.findOne).toHaveBeenCalledWith({
      where: { id: 42, clientId: 7, usedAt: IsNull(), revokedAt: IsNull() },
    });
  });

  it('buscar una pendiente por id de otra empresa no devuelve nada, y no lo distingue de no existir', async () => {
    const { repo, orm } = makeRepo();
    // La consulta acotada no encuentra fila: el doble responde `null`, igual
    // que MySQL con un id que existe pero es de otra empresa.
    await expect(repo.findPendingByIdForClient(42, 7)).resolves.toBeNull();
    const [{ where }] = orm.findOne.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(where.clientId).toBe(7);
  });

  /**
   * `revokeLiveByEmail` acota por empresa además de por correo. Sin el
   * `clientId` en el WHERE, invitar desde la empresa B a una dirección que la
   * empresa A tiene pendiente le anularía la invitación a A — un efecto
   * cruzado entre empresas por la puerta de atrás.
   */
  it('revocar invitaciones vivas va acotado a la empresa que pide, no solo al correo', async () => {
    const { repo, orm } = makeRepo();
    await repo.revokeLiveByEmail('Ana@Kuboti.com', 7, new Date('2026-08-26T15:00:00.000Z'));
    const [where] = orm.actualizado[0];
    expect(where).toEqual(
      expect.objectContaining({ email: 'ana@kuboti.com', clientId: 7 }),
    );
  });

  it('marcar el envío guarda el instante y el error, sin tocar nada más', async () => {
    const { repo, orm } = makeRepo();
    const cuando = new Date('2026-08-26T15:00:00.000Z');
    await repo.markSent(9, cuando, 'SMTP dijo que no');
    expect(orm.actualizado[0]).toEqual([9, { lastSentAt: cuando, sendError: 'SMTP dijo que no' }]);
  });

  it('un envío correcto borra el error anterior en vez de dejarlo colgando', async () => {
    const { repo, orm } = makeRepo();
    const cuando = new Date('2026-08-26T15:00:00.000Z');
    await repo.markSent(9, cuando, null);
    expect(orm.actualizado[0]).toEqual([9, { lastSentAt: cuando, sendError: null }]);
  });

  it('encuentra por huella sin filtrar por estado: una usada o caducada también aparece', async () => {
    const { repo, orm } = makeRepo();
    orm.findOne.mockResolvedValueOnce({ id: 9, usedAt: new Date() } as any);

    const encontrada = await repo.findByFingerprint('f'.repeat(64));

    expect(orm.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { secretFingerprint: 'f'.repeat(64) } }),
    );
    expect(encontrada).toEqual({ id: 9, usedAt: expect.any(Date) });
  });
});
