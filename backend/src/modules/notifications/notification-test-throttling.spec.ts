import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { THROTTLED_MESSAGE } from '../../common/guards/api-throttler.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import {
  NOTIFICATION_TEST_THROTTLE,
  PORTAL_AUTH_THROTTLERS,
  THROTTLER_BURST,
  THROTTLER_SUSTAINED,
} from '../../config/throttler.config';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { NotificationTemplatesController } from './notification-templates.controller';
import { NotificationTemplatesService } from './notification-templates.service';

/**
 * El envío de prueba de una plantilla es la única ruta del panel interno con
 * un efecto externo e irreversible: cada llamada saca un correo de verdad por
 * el SMTP de producción. Sin límite, un administrador con el dedo pegado al
 * botón —o una sesión suya comprometida— quema la cuota del proveedor y la
 * reputación del remitente, que es el activo que la §9 de la spec señala como
 * riesgo: si el dominio se quema, los avisos acaban en no deseado y toda la
 * funcionalidad deja de servir.
 *
 * Se prueba sobre HTTP real porque el throttler cuenta por `req.ip`, algo que
 * un `ExecutionContext` simulado no tiene. Los guards de sesión van doblados
 * —lo que se prueba es el límite, no la autenticación— y el servicio también,
 * para que ningún correo salga de verdad desde la suite.
 */
describe('Envío de prueba de plantilla — limitación de frecuencia (integración HTTP)', () => {
  let app: TestHttpApp;
  let sendTest: jest.Mock;
  let preview: jest.Mock;

  const ADMIN_EMAIL = 'admin@kubo.pe';

  const postTest = () => app.post('/notification-templates/1/test');

  beforeEach(async () => {
    sendTest = jest.fn().mockResolvedValue({ to: ADMIN_EMAIL });
    preview = jest.fn().mockResolvedValue({ subject: 's', html: '<p>h</p>', text: 't' });

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS })],
      controllers: [NotificationTemplatesController],
      providers: [
        { provide: NotificationTemplatesService, useValue: { sendTest, preview, list: jest.fn(), update: jest.fn() } },
      ],
    })
      // El usuario del token lo pone el guard de sesión: sin él, `@CurrentUser`
      // no tendría de dónde sacar el correo del destinatario.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { id: 1, email: ADMIN_EMAIL, role: 'ADMIN' };
          return true;
        },
      })
      .overrideGuard(StaffOnlyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = await startTestHttpApp(moduleRef);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('los límites acordados son 3 por minuto y 10 cada 15 minutos', () => {
    expect(NOTIFICATION_TEST_THROTTLE[THROTTLER_BURST]).toEqual({ ttl: 60_000, limit: 3 });
    expect(NOTIFICATION_TEST_THROTTLE[THROTTLER_SUSTAINED]).toEqual({ ttl: 900_000, limit: 10 });
  });

  it('admite tres envíos y corta el cuarto', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await postTest()).status).toBe(201);
    }
    expect((await postTest()).status).toBe(429);
  });

  it('el corte ocurre antes de llegar al servicio: no sale un cuarto correo', async () => {
    for (let i = 0; i < 4; i += 1) await postTest();
    expect(sendTest).toHaveBeenCalledTimes(3);
  });

  it('la respuesta del límite mantiene la forma { code, message } en español', async () => {
    for (let i = 0; i < 3; i += 1) await postTest();
    const res = await postTest();
    expect(res.status).toBe(429);
    // El filtro global añade `statusCode`, `path` y `timestamp` a todo error;
    // lo que se fija aquí es el par { code, message } de la convención.
    expect(res.body).toMatchObject({ code: 'TOO_MANY_REQUESTS', message: THROTTLED_MESSAGE });
  });

  it('la previsualización no se limita: no envía nada, y acotarla sería molestar sin motivo', async () => {
    for (let i = 0; i < 6; i += 1) {
      const res = await app.post('/notification-templates/1/preview');
      expect(res.status).toBe(201);
    }
    expect(preview).toHaveBeenCalledTimes(6);
  });
});
