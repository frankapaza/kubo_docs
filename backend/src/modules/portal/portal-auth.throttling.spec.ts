import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { THROTTLED_MESSAGE } from '../../common/guards/api-throttler.guard';
import {
  PORTAL_AUTH_THROTTLERS,
  PORTAL_REFRESH_THROTTLE,
  THROTTLER_BURST,
  THROTTLER_SUSTAINED,
} from '../../config/throttler.config';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthService } from './portal-auth.service';

/**
 * Prueba de integración de la limitación de intentos del portal (§9 de la
 * spec). Levanta el controlador real con su guard real y hace peticiones HTTP
 * de verdad: el throttler cuenta por `req.ip`, algo que un `ExecutionContext`
 * simulado no tiene.
 *
 * `PortalAuthService` va mockeado —el login real necesita base de datos— pero
 * eso no debilita nada: lo que se prueba es que el guard corta *antes* de
 * llegar al servicio.
 */
describe('Portal auth — limitación de intentos (integración HTTP)', () => {
  let app: TestHttpApp;
  let login: jest.Mock;
  let refresh: jest.Mock;

  const REGISTERED_EMAIL = 'portal.test@clienteprueba.pe';
  const UNKNOWN_EMAIL = 'no.existe@ejemplo.pe';
  const credentials = (email: string) => ({ email, password: 'ContraseñaMala1' });

  // Un JWT sintácticamente válido: `PortalRefreshTokenDto` exige `@IsJWT`, y
  // si el pipe rechazara el cuerpo antes, el 429 llegaría por otro camino.
  const SYNTACTIC_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.c2lnbmF0dXJl';

  beforeEach(async () => {
    // Fallo de credenciales para cualquier correo, exista o no: es lo que hace
    // el servicio real, que no distingue entre ambos casos.
    login = jest.fn().mockRejectedValue(
      new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Correo o contraseña incorrectos.',
      }),
    );
    refresh = jest.fn().mockRejectedValue(
      new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'El token de refresco no es válido.',
      }),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS })],
      controllers: [PortalAuthController],
      providers: [{ provide: PortalAuthService, useValue: { login, refresh } }],
    }).compile();

    app = await startTestHttpApp(moduleRef);
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('los límites acordados', () => {
    it('el login admite 5 por minuto y 20 cada 15 minutos', () => {
      expect(PORTAL_AUTH_THROTTLERS).toEqual([
        { name: THROTTLER_BURST, ttl: 60_000, limit: 5 },
        { name: THROTTLER_SUSTAINED, ttl: 900_000, limit: 20 },
      ]);
    });

    it('el refresco admite 10 por minuto y 60 cada 15 minutos', () => {
      expect(PORTAL_REFRESH_THROTTLE).toEqual({
        [THROTTLER_BURST]: { ttl: 60_000, limit: 10 },
        [THROTTLER_SUSTAINED]: { ttl: 900_000, limit: 60 },
      });
    });
  });

  describe('POST /portal/auth/login', () => {
    it('deja pasar los 5 primeros intentos y corta el sexto con 429', async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await app.post('/portal/auth/login', {
          body: credentials(REGISTERED_EMAIL),
        });
        expect(res.status).toBe(401);
      }

      const blocked = await app.post('/portal/auth/login', {
        body: credentials(REGISTERED_EMAIL),
      });
      expect(blocked.status).toBe(429);
    });

    it('la respuesta limitada tiene la forma { code, message } con el mensaje en español', async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await app.post('/portal/auth/login', { body: credentials(REGISTERED_EMAIL) });
      }

      const blocked = await app.post('/portal/auth/login', {
        body: credentials(REGISTERED_EMAIL),
      });

      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: THROTTLED_MESSAGE,
      });
      // Nada del throttler de serie se cuela: ni el nombre de su excepción ni
      // el 'INTERNAL_ERROR' que le pondría el filtro por no traer `code`.
      expect(JSON.stringify(blocked.body)).not.toContain('ThrottlerException');
      expect(blocked.body.code).not.toBe('INTERNAL_ERROR');
    });

    it('el guard corta antes de tocar el servicio: bcrypt no se llega a ejecutar', async () => {
      for (let attempt = 1; attempt <= 6; attempt++) {
        await app.post('/portal/auth/login', { body: credentials(REGISTERED_EMAIL) });
      }
      // 6 peticiones, 5 llamadas: la sexta murió en el guard.
      expect(login).toHaveBeenCalledTimes(5);
    });

    it('no permite distinguir un correo dado de alta de uno que no lo está', async () => {
      // Se agota el límite con el correo registrado...
      for (let attempt = 1; attempt <= 5; attempt++) {
        await app.post('/portal/auth/login', { body: credentials(REGISTERED_EMAIL) });
      }

      const known = await app.post('/portal/auth/login', {
        body: credentials(REGISTERED_EMAIL),
      });
      const unknown = await app.post('/portal/auth/login', {
        body: credentials(UNKNOWN_EMAIL),
      });

      expect(known.status).toBe(429);
      expect(unknown.status).toBe(429);
      // Idénticas salvo el `timestamp`, que es la hora y no depende del correo.
      const { timestamp: _t1, ...knownBody } = known.body;
      const { timestamp: _t2, ...unknownBody } = unknown.body;
      expect(unknownBody).toEqual(knownBody);
      expect(JSON.stringify(unknownBody)).not.toContain(UNKNOWN_EMAIL);
    });

    it('un cuerpo malformado también consume intentos: el guard corre antes que el pipe', async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await app.post('/portal/auth/login', { body: { email: 'no-es-un-correo' } });
        expect(res.status).toBe(400);
      }

      const blocked = await app.post('/portal/auth/login', {
        body: credentials(REGISTERED_EMAIL),
      });
      expect(blocked.status).toBe(429);
    });
  });

  describe('POST /portal/auth/refresh', () => {
    it('deja pasar los 10 primeros intentos y corta el undécimo con 429', async () => {
      for (let attempt = 1; attempt <= 10; attempt++) {
        const res = await app.post('/portal/auth/refresh', {
          body: { refreshToken: SYNTACTIC_JWT },
        });
        expect(res.status).toBe(401);
      }

      const blocked = await app.post('/portal/auth/refresh', {
        body: { refreshToken: SYNTACTIC_JWT },
      });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: THROTTLED_MESSAGE,
      });
    });

    it('lleva su propio contador: agotar el login no bloquea el refresco', async () => {
      for (let attempt = 1; attempt <= 6; attempt++) {
        await app.post('/portal/auth/login', { body: credentials(REGISTERED_EMAIL) });
      }

      const res = await app.post('/portal/auth/refresh', {
        body: { refreshToken: SYNTACTIC_JWT },
      });
      expect(res.status).toBe(401);
    });
  });
});
