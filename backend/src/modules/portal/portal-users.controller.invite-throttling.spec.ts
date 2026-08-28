import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { THROTTLED_MESSAGE } from '../../common/guards/api-throttler.guard';
import {
  PORTAL_AUTH_THROTTLERS,
  THROTTLER_BURST,
  THROTTLER_SUSTAINED,
} from '../../config/throttler.config';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { ClientJwtGuard } from './guards/client-jwt.guard';
import { PortalUsersController } from './portal-users.controller';
import { PortalUsersService } from './portal-users.service';
import { PortalInvitationsService } from './portal-invitations.service';

/**
 * Doble de `ClientJwtGuard` que deja pasar cualquier petición como el
 * administrador de la empresa 7, sin verificar ningún JWT de verdad: lo que
 * se prueba aquí es el tope de frecuencia de `POST /portal/usuarios/invitaciones`
 * (finding C de la revisión — el oráculo de libre/ocupado no llevaba freno),
 * no la autenticación, que ya prueba `client-jwt.guard` por su cuenta.
 * `ClientAdminGuard` sí corre de verdad: pasa porque el usuario falso trae
 * `isClientAdmin: true`.
 */
class FakeClientSession implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = { clientUserId: 3, clientId: 7, email: 'admin@kuboti.com', isClientAdmin: true };
    return true;
  }
}

describe('POST /portal/usuarios/invitaciones — limitación de intentos (integración HTTP)', () => {
  let app: TestHttpApp;
  let invite: jest.Mock;

  const DTO = { email: 'nuevo@kuboti.com', fullName: 'Nuevo Nombre' };

  beforeEach(async () => {
    invite = jest.fn().mockResolvedValue({
      id: 1,
      fullName: 'Nuevo Nombre',
      email: 'nuevo@kuboti.com',
      expiresAt: new Date().toISOString(),
      lastSentAt: null,
      deliveryFailed: false,
      createdAt: new Date().toISOString(),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS })],
      controllers: [PortalUsersController],
      providers: [
        { provide: PortalUsersService, useValue: {} },
        {
          provide: PortalInvitationsService,
          useValue: { invite, listPending: jest.fn(), resend: jest.fn() },
        },
      ],
    })
      .overrideGuard(ClientJwtGuard)
      .useClass(FakeClientSession)
      .compile();

    app = await startTestHttpApp(moduleRef);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('el límite es el mismo que ya usa el login del portal', () => {
    expect(PORTAL_AUTH_THROTTLERS).toEqual([
      { name: THROTTLER_BURST, ttl: 60_000, limit: 5 },
      { name: THROTTLER_SUSTAINED, ttl: 900_000, limit: 20 },
    ]);
  });

  it('deja pasar los 5 primeros intentos y corta el sexto con 429', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await app.post('/portal/usuarios/invitaciones', { body: DTO });
      expect(res.status).toBe(201);
    }

    const blocked = await app.post('/portal/usuarios/invitaciones', { body: DTO });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'TOO_MANY_REQUESTS', message: THROTTLED_MESSAGE });
  });

  /**
   * Falla cerrado por construcción, no por accidente: el guard corre antes
   * que el servicio, así que el sexto intento nunca llega a `invite`.
   */
  it('el guard corta antes de tocar el servicio', async () => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      await app.post('/portal/usuarios/invitaciones', { body: DTO });
    }
    expect(invite).toHaveBeenCalledTimes(5);
  });
});
