import { EntityManager, Repository } from 'typeorm';

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
});
