import { INVITATION_INVALID_MESSAGE, PortalInvitationsService } from './portal-invitations.service';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

const SECRETO = 'secreto-de-pruebas-de-la-vista-previa';

/** Invitación tal como la devuelve TypeORM: los `bigint` salen como CADENA. */
function invitacion(over: Record<string, unknown> = {}) {
  return {
    id: '11',
    clientId: '7',
    email: 'nuevo@kuboti.com',
    fullName: 'Nuevo Nombre',
    secretFingerprint: fingerprintInvitationSecret(SECRETO),
    invitedByClientUserId: '3',
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    usedAt: null,
    acceptedClientUserId: null,
    revokedAt: null,
    lastSentAt: null,
    sendError: null,
    createdAt: new Date('2026-08-26T15:00:00.000Z'),
    ...over,
  } as any;
}

/**
 * `preview` no abre transacción — es una lectura simple, nunca escribe —así
 * que aquí no hace falta el doble del `EntityManager` que usa
 * `portal-invitations.accept.spec.ts`: basta con el repositorio de
 * invitaciones.
 */
function makeService(opciones: {
  fila?: any;
  invitador?: any;
  empresa?: any;
} = {}) {
  const invitations = {
    runInTransaction: jest.fn(),
    create: jest.fn(),
    findLiveByEmail: jest.fn(async () => null),
    listPendingByClient: jest.fn(async () => []),
    findPendingByIdForClient: jest.fn(async () => null),
    findByFingerprint: jest.fn(async () => opciones.fila ?? null),
    revokeLiveByEmail: jest.fn(async () => undefined),
    markSent: jest.fn(async () => undefined),
  };

  const clientUsers = {
    findByEmail: jest.fn(async () => null),
    findById: jest.fn(async () => opciones.invitador ?? { id: '3', isActive: 1 }),
  };
  const email = { send: jest.fn(async () => ({ messageId: 'x', accepted: [], rejected: [] })) };
  const clients = {
    findByIdOrFail: jest.fn(async () =>
      opciones.empresa ?? { id: 7, razonSocial: 'Acme S.A.C.', status: 'CLIENT' },
    ),
  };
  const config = { get: (k: string, f?: string) => f };

  const service = new PortalInvitationsService(
    invitations as any, clientUsers as any, email as any, clients as any, config as any,
  );
  return { service, invitations, clientUsers, clients };
}

describe('PortalInvitationsService.preview', () => {
  it('devuelve el nombre de la persona invitada y el de su empresa, y nada más', async () => {
    const { service } = makeService({ fila: invitacion() });
    const vista = await service.preview(SECRETO);
    expect(vista).toEqual({ fullName: 'Nuevo Nombre', clientName: 'Acme S.A.C.' });
  });

  it('busca por huella, y el secreto en claro no llega a la consulta', async () => {
    const { service, invitations } = makeService({ fila: invitacion() });
    await service.preview(SECRETO);
    expect(invitations.findByFingerprint).toHaveBeenCalledWith(
      fingerprintInvitationSecret(SECRETO),
    );
  });

  /**
   * LA COMPROBACIÓN QUE SOSTIENE LA DECISIÓN 10 DE LA SPEC: consultar no deja
   * ningún rastro. Si `preview` marcara algo, dos personas que compartieran
   * el mismo enlace por error (o un lector automático de correo que
   * precargue la página) inutilizarían la invitación sin que nadie la
   * hubiera aceptado de verdad.
   */
  it('no escribe nada: ni abre transacción, ni marca usada, ni revoca', async () => {
    const { service, invitations } = makeService({ fila: invitacion() });
    await service.preview(SECRETO);
    expect(invitations.runInTransaction).not.toHaveBeenCalled();
    expect(invitations.markSent).not.toHaveBeenCalled();
    expect(invitations.revokeLiveByEmail).not.toHaveBeenCalled();
  });

  it('el correo y los identificadores nunca aparecen en la vista', async () => {
    const { service } = makeService({ fila: invitacion() });
    const vista = await service.preview(SECRETO);
    expect(JSON.stringify(vista)).not.toContain('nuevo@kuboti.com');
    expect(vista).not.toHaveProperty('id');
    expect(vista).not.toHaveProperty('email');
    expect(vista).not.toHaveProperty('expiresAt');
    expect(vista).not.toHaveProperty('invitedByClientUserId');
  });
});

describe('la vista previa responde exactamente igual que aceptar ante cualquier fallo', () => {
  const casos: Array<[string, Parameters<typeof makeService>[0]]> = [
    ['no existe', { fila: null }],
    ['caducada', { fila: invitacion({ expiresAt: new Date(Date.now() - 1000) }) }],
    ['ya usada', { fila: invitacion({ usedAt: new Date() }) }],
    ['revocada por otra posterior', { fila: invitacion({ revokedAt: new Date() }) }],
    ['quien invitó está desactivado', { fila: invitacion(), invitador: { id: '3', isActive: 0 } }],
    [
      'la empresa ya no es cliente',
      { fila: invitacion(), empresa: { id: 7, razonSocial: 'Acme', status: 'FORMER_CLIENT' } },
    ],
  ];

  it.each(casos)('%s falla con el mismo cuerpo que aceptar', async (_nombre, opciones) => {
    const { service } = makeService(opciones);
    await expect(service.preview(SECRETO)).rejects.toMatchObject({
      response: { code: 'INVITACION_NO_VALIDA', message: INVITATION_INVALID_MESSAGE },
    });
  });

  it('los seis cuerpos son idénticos entre sí', async () => {
    const cuerpos = [];
    for (const [, opciones] of casos) {
      const { service } = makeService(opciones);
      cuerpos.push(await service.preview(SECRETO).catch((e) => JSON.stringify(e.getResponse())));
    }
    expect(new Set(cuerpos).size).toBe(1);
  });

  /**
   * Decisión 1 de la spec: un prospecto (`status: 'PROSPECT'`) NO es una
   * empresa desactivada — solo `FORMER_CLIENT` invalida el enlace. Sin esta
   * prueba, alguien podría "arreglar" el `if` para rechazar cualquier cosa
   * que no sea `'CLIENT'` y dejaría sin invitaciones a cualquier prospecto en
   * proceso de alta.
   */
  it('un prospecto sí puede tener una invitación válida', async () => {
    const { service } = makeService({
      fila: invitacion(),
      empresa: { id: 7, razonSocial: 'Acme', status: 'PROSPECT' },
    });
    await expect(service.preview(SECRETO)).resolves.toEqual({
      fullName: 'Nuevo Nombre',
      clientName: 'Acme',
    });
  });
});
