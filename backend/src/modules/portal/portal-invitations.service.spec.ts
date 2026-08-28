import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { INVITE_REJECTED_MESSAGE, PortalInvitationsService } from './portal-invitations.service';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

function makeService(opciones: {
  usuarioExistente?: any;
  invitacionViva?: any;
  pendiente?: any;
  envioFalla?: Error;
} = {}) {
  const escritas: any[] = [];
  const enviados: any[] = [];
  const marcados: any[] = [];

  const invitations = {
    escritas, marcados,
    create: jest.fn(async (d: any) => {
      escritas.push(d);
      return { id: 11, usedAt: null, revokedAt: null, lastSentAt: null, sendError: null,
        createdAt: new Date('2026-08-26T15:00:00.000Z'), ...d };
    }),
    findLiveByEmail: jest.fn(async () => opciones.invitacionViva ?? null),
    listPendingByClient: jest.fn(async () => []),
    findPendingByIdForClient: jest.fn(async () => opciones.pendiente ?? null),
    revokeLiveByEmail: jest.fn(async () => undefined),
    markSent: jest.fn(async (...args: any[]) => {
      marcados.push(args);
    }),
  };

  const clientUsers = { findByEmail: jest.fn(async () => opciones.usuarioExistente ?? null) };

  const email = {
    enviados,
    send: jest.fn(async (input: any) => {
      if (opciones.envioFalla) throw opciones.envioFalla;
      enviados.push(input);
      return { messageId: 'x', accepted: [input.to], rejected: [] };
    }),
  };

  const clients = { findByIdOrFail: jest.fn(async () => ({ id: 7, razonSocial: 'Acme S.A.C.' })) };
  const config = { get: (k: string, f?: string) => (k === 'FRONTEND_URL' ? 'https://kuboti.com' : f) };

  const service = new PortalInvitationsService(
    invitations as any, clientUsers as any, email as any, clients as any, config as any,
  );
  return { service, invitations, clientUsers, email, clients };
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

describe('el envío de la invitación', () => {
  it('sale en el acto, a la dirección invitada, con el enlace dentro', async () => {
    const { service, email } = makeService();
    await service.invite(7, 3, DTO);

    expect(email.send).toHaveBeenCalledTimes(1);
    const enviado = email.enviados[0];
    expect(enviado.to).toBe('Nuevo@Kuboti.com');
    expect(enviado.html).toMatch(/https:\/\/kuboti\.com\/portal\/invitacion\/[A-Za-z0-9_-]{43}/);
  });

  it('el enlace del correo lleva el secreto que corresponde a la huella guardada', async () => {
    const { service, email, invitations } = makeService();
    await service.invite(7, 3, DTO);

    const secreto = email.enviados[0].html.match(/\/portal\/invitacion\/([A-Za-z0-9_-]{43})/)[1];
    expect(invitations.escritas[0].secretFingerprint).toBe(fingerprintInvitationSecret(secreto));
  });

  /**
   * Decisión 6 de la spec: sin cola no hay reintento automático, así que la
   * invitación NO puede perderse porque el SMTP esté caído. Queda creada, se
   * anota el fallo, y el administrador la ve pendiente con opción de reenviar.
   */
  it('si el correo falla, la invitación queda creada igual y se anota el fallo', async () => {
    const { service, invitations } = makeService({ envioFalla: new Error('SMTP dijo que no') });

    const vista = await service.invite(7, 3, DTO);

    expect(invitations.create).toHaveBeenCalledTimes(1);
    expect(vista.deliveryFailed).toBe(true);
    expect(invitations.marcados[0][2]).toContain('SMTP dijo que no');
  });

  it('un envío correcto deja el registro sin error', async () => {
    const { service, invitations } = makeService();
    const vista = await service.invite(7, 3, DTO);
    expect(invitations.marcados[0][2]).toBeNull();
    expect(vista.deliveryFailed).toBe(false);
  });

  it('el secreto no aparece en la vista que devuelve la petición', async () => {
    const { service, email } = makeService();
    const vista = await service.invite(7, 3, DTO);
    const secreto = email.enviados[0].html.match(/\/portal\/invitacion\/([A-Za-z0-9_-]{43})/)[1];
    expect(JSON.stringify(vista)).not.toContain(secreto);
  });
});

describe('PortalInvitationsService.resend', () => {
  const pendiente = {
    id: '11', clientId: '7', email: 'nuevo@kuboti.com', fullName: 'Nuevo Nombre',
    secretFingerprint: 'a'.repeat(64), invitedByClientUserId: '3',
    expiresAt: new Date('2026-09-02T15:00:00.000Z'),
    usedAt: null, revokedAt: null, lastSentAt: null, sendError: 'fallo viejo',
    acceptedClientUserId: null, createdAt: new Date('2026-08-26T15:00:00.000Z'),
  };

  /**
   * El reenvío emite un secreto NUEVO y revoca el anterior. No se puede
   * reenviar el viejo: no lo tenemos —solo su huella— y ese es justo el punto
   * de guardar solo la huella.
   */
  it('emite un secreto nuevo y deja de servir el anterior', async () => {
    const { service, invitations, email } = makeService({ pendiente });
    await service.resend(7, 11);

    expect(invitations.revokeLiveByEmail).toHaveBeenCalledWith(
      'nuevo@kuboti.com', 7, expect.any(Date),
    );
    const secreto = email.enviados[0].html.match(/\/portal\/invitacion\/([A-Za-z0-9_-]{43})/)[1];
    expect(invitations.escritas[0].secretFingerprint).toBe(fingerprintInvitationSecret(secreto));
  });

  it('conserva el nombre, el correo y quién invitó de la invitación original', async () => {
    const { service, invitations } = makeService({ pendiente });
    await service.resend(7, 11);
    expect(invitations.escritas[0]).toMatchObject({
      clientId: 7, email: 'nuevo@kuboti.com', fullName: 'Nuevo Nombre', invitedByClientUserId: 3,
    });
  });

  it('una invitación de otra empresa responde 404, no 403, y no manda nada', async () => {
    const { service, email } = makeService({ pendiente: null });
    await expect(service.resend(7, 11)).rejects.toThrow(NotFoundException);
    expect(email.send).not.toHaveBeenCalled();
  });
});
