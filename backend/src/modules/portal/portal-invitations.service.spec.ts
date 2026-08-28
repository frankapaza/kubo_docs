import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { INVITE_REJECTED_MESSAGE, PortalInvitationsService } from './portal-invitations.service';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

function makeService(opciones: {
  usuarioExistente?: any;
  invitacionViva?: any;
} = {}) {
  const escritas: any[] = [];
  const revocadas: any[] = [];

  const invitations = {
    escritas,
    revocadas,
    create: jest.fn(async (d: any) => {
      escritas.push(d);
      return { id: 11, usedAt: null, revokedAt: null, lastSentAt: null, sendError: null,
        createdAt: new Date('2026-08-26T15:00:00.000Z'), ...d };
    }),
    findLiveByEmail: jest.fn(async () => opciones.invitacionViva ?? null),
    listPendingByClient: jest.fn(async () => []),
    revokeLiveByEmail: jest.fn(async (...args: any[]) => {
      revocadas.push(args);
    }),
  };

  const clientUsers = {
    findByEmail: jest.fn(async () => opciones.usuarioExistente ?? null),
  };

  const service = new PortalInvitationsService(invitations as any, clientUsers as any);
  return { service, invitations, clientUsers };
}

const DTO = { email: 'Nuevo@Kuboti.com', fullName: 'Nuevo Nombre' };

describe('PortalInvitationsService.invite', () => {
  it('fija la empresa desde el argumento de sesión', async () => {
    const { service, invitations } = makeService();
    await service.invite(7, 3, DTO);
    expect(invitations.escritas[0].clientId).toBe(7);
    expect(invitations.escritas[0].invitedByClientUserId).toBe(3);
  });

  /**
   * LA PRUEBA DE LA FRONTERA, con la petición manipulada y no confiando en el
   * tipo. El `ValidationPipe` global ya rechazaría un `clientId` en el cuerpo,
   * pero esa es la SEGUNDA barrera. Esta comprueba la primera: aunque llegara,
   * el servicio no lo lee.
   */
  it('ignora una empresa ajena colada en el cuerpo', async () => {
    const { service, invitations } = makeService();
    await service.invite(7, 3, { ...DTO, clientId: 99 } as any);
    expect(invitations.escritas[0].clientId).toBe(7);
  });

  /**
   * Decisión 2 de la spec: el administrador de cliente NO puede nombrar
   * administradores. Ni aunque la petición lo pida explícitamente. Lo que se
   * guarda en la invitación no lleva ningún campo de rol, así que no hay por
   * dónde colarlo.
   */
  it('un isAdmin en el cuerpo no llega a la invitación por ningún camino', async () => {
    const { service, invitations } = makeService();
    await service.invite(7, 3, { ...DTO, isAdmin: true } as any);
    expect(JSON.stringify(invitations.escritas[0])).not.toContain('isAdmin');
  });

  it('guarda la huella del secreto, y nunca el secreto', async () => {
    const { service, invitations } = makeService();
    await service.invite(7, 3, DTO);
    const fila = invitations.escritas[0];
    expect(fila.secretFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fila).not.toHaveProperty('secret');
  });

  it('el secreto que se genera es el que corresponde a la huella guardada', async () => {
    const { service, invitations } = makeService();
    const { secret } = await service.inviteWithSecret(7, 3, DTO);
    expect(invitations.escritas[0].secretFingerprint).toBe(fingerprintInvitationSecret(secret));
  });

  it('la vista que devuelve no contiene ni el secreto ni la huella', async () => {
    const { service } = makeService();
    const vista = await service.invite(7, 3, DTO);
    expect(Object.keys(vista).sort()).toEqual(
      ['createdAt', 'deliveryFailed', 'email', 'expiresAt', 'fullName', 'id', 'lastSentAt'].sort(),
    );
  });

  it('caduca a los 7 días del instante en que se crea', async () => {
    const { service, invitations } = makeService();
    const antes = Date.now();
    await service.invite(7, 3, DTO);
    const caduca = (invitations.escritas[0].expiresAt as Date).getTime();
    expect(caduca - antes).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 5000);
    expect(caduca - antes).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 5000);
  });

  /**
   * Decisión 7 de la spec. Decir «ese correo ya está registrado» convierte el
   * portal en un comprobador de quiénes son nuestros clientes.
   */
  it('un correo que ya es de un usuario de la propia empresa se rechaza con el texto genérico', async () => {
    const { service, invitations } = makeService({
      usuarioExistente: { id: '5', clientId: '7', email: 'nuevo@kuboti.com' },
    });
    await expect(service.invite(7, 3, DTO)).rejects.toMatchObject({
      response: { message: INVITE_REJECTED_MESSAGE },
    });
    expect(invitations.create).not.toHaveBeenCalled();
  });

  it('un correo que ya es de OTRA empresa se rechaza con exactamente el mismo cuerpo', async () => {
    const propio = makeService({ usuarioExistente: { id: '5', clientId: '7' } });
    const ajeno = makeService({ usuarioExistente: { id: '8', clientId: '99' } });

    const cuerpoPropio = await propio.service.invite(7, 3, DTO).catch((e) => e.getResponse());
    const cuerpoAjeno = await ajeno.service.invite(7, 3, DTO).catch((e) => e.getResponse());

    expect(cuerpoPropio).toEqual(cuerpoAjeno);
  });

  it('un correo con una invitación viva en OTRA empresa se rechaza, y no se le toca la suya', async () => {
    const { service, invitations } = makeService({
      invitacionViva: { id: 4, clientId: '99', email: 'nuevo@kuboti.com' },
    });
    await expect(service.invite(7, 3, DTO)).rejects.toThrow(BadRequestException);
    expect(invitations.revokeLiveByEmail).not.toHaveBeenCalled();
    expect(invitations.create).not.toHaveBeenCalled();
  });

  /**
   * «Un mismo correo no acumula invitaciones vivas: invitar de nuevo reemplaza
   * la anterior, que deja de servir.» Dentro de la MISMA empresa, y en este
   * orden: primero se revoca la vieja, después se crea la nueva. Al revés,
   * durante un instante habría dos vivas y la revocación se llevaría por
   * delante la recién creada.
   */
  it('invitar de nuevo al mismo correo dentro de la empresa revoca la anterior antes de crear la nueva', async () => {
    const { service, invitations } = makeService({
      invitacionViva: { id: 4, clientId: '7', email: 'nuevo@kuboti.com' },
    });
    await service.invite(7, 3, DTO);

    expect(invitations.revokeLiveByEmail).toHaveBeenCalledWith(
      'Nuevo@Kuboti.com', 7, expect.any(Date),
    );
    expect(invitations.revokeLiveByEmail.mock.invocationCallOrder[0]).toBeLessThan(
      invitations.create.mock.invocationCallOrder[0],
    );
  });

  it.each([[0], [-1], [Number.NaN]])(
    'una sesión con clientId inservible (%s) se rechaza sin escribir nada',
    async (malo) => {
      const { service, invitations } = makeService();
      await expect(service.invite(malo as number, 3, DTO)).rejects.toThrow(UnauthorizedException);
      expect(invitations.create).not.toHaveBeenCalled();
    },
  );

  it('una sesión sin clientUserId utilizable tampoco escribe: la invitación quedaría sin autor', async () => {
    const { service, invitations } = makeService();
    await expect(service.invite(7, 0, DTO)).rejects.toThrow(UnauthorizedException);
    expect(invitations.create).not.toHaveBeenCalled();
  });
});

describe('PortalInvitationsService.listPending', () => {
  it('acota por la empresa de la sesión', async () => {
    const { service, invitations } = makeService();
    await service.listPending(7);
    expect(invitations.listPendingByClient).toHaveBeenCalledWith(7, expect.any(Date));
  });
});
