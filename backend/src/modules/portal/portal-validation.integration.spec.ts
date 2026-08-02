import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { PORTAL_AUTH_THROTTLERS } from '../../config/throttler.config';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalTicketsController } from './portal-tickets.controller';
import { PortalTicketsService } from './portal-tickets.service';
import { ClientJwtStrategy } from './strategies/client-jwt.strategy';

/**
 * Los errores de validación son la única respuesta del portal que no pasaba
 * por la disciplina de proyección campo por campo que rige todo lo demás:
 * salían los literales por defecto de class-validator, en inglés y con los
 * nombres internos de las propiedades dentro («subject must be shorter than or
 * equal to 240 characters», «property clientId should not exist»). Las tres
 * pantallas del portal los pintan tal cual.
 *
 * Se comprueba sobre el ciclo completo de la petición porque el resultado
 * depende de tres piezas a la vez —el DTO, el `ValidationPipe` global y el
 * `HttpExceptionFilter`— y ninguna de ellas sola determina lo que ve el
 * usuario.
 */

const CLIENT_ACCESS_SECRET = 'secreto-de-pruebas-del-portal';

/** Cualquier resto de inglés de class-validator delata un mensaje sin traducir. */
const ENGLISH_LEAKS = [
  'must be',
  'should not',
  'shorter than',
  'longer than',
  'must not be',
  'property ',
];

/** Nombres internos de propiedades que no deben aparecer en ninguna respuesta. */
const INTERNAL_PROPERTY_NAMES = ['clientId', 'descriptionMd', 'rawText', 'passwordHash'];

describe('Portal — errores de validación (integración HTTP)', () => {
  let app: TestHttpApp;
  let token: string;

  beforeAll(async () => {
    const config = {
      get: (key: string, fallback?: string) =>
        ({ JWT_CLIENT_ACCESS_SECRET: CLIENT_ACCESS_SECRET })[key] ?? fallback,
    };

    const moduleRef = await Test.createTestingModule({
      // El throttler de `PortalAuthController` no es el objeto de esta prueba,
      // pero sin él el controlador no se puede instanciar.
      imports: [PassportModule, ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS })],
      controllers: [PortalAuthController, PortalTicketsController],
      providers: [
        { provide: ConfigService, useValue: config },
        ClientJwtStrategy,
        { provide: PortalAuthService, useValue: { login: jest.fn(), refresh: jest.fn() } },
        {
          provide: PortalTicketsService,
          useValue: {
            list: jest.fn().mockResolvedValue([]),
            detail: jest.fn().mockResolvedValue({ id: 1 }),
            create: jest.fn().mockResolvedValue({ id: 1 }),
            systems: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    app = await startTestHttpApp(moduleRef);

    token = new JwtService({}).sign(
      { sub: 42, email: 'portal.test@clienteprueba.pe', clientId: 7, isClientAdmin: false },
      { secret: CLIENT_ACCESS_SECRET, expiresIn: '5m' },
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  /** El contrato que el frontend consume: `{ code, message }` con message string. */
  const expectSpanishValidationError = (body: any) => {
    expect(body.code).toBe('VALIDATION_ERROR');
    // El campo `message` está tipado como string en el filtro pero
    // class-validator manda un string[]: el diálogo de alta renderizaba la
    // concatenación corrida, sin separadores.
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);

    for (const leak of ENGLISH_LEAKS) {
      expect(body.message.toLowerCase()).not.toContain(leak.toLowerCase());
    }
    for (const name of INTERNAL_PROPERTY_NAMES) {
      expect(body.message).not.toContain(name);
    }
  };

  describe('POST /portal/auth/login', () => {
    it('un correo mal formado devuelve un mensaje en español', async () => {
      const res = await app.post('/portal/auth/login', {
        body: { email: 'no-es-un-correo', password: 'x' },
      });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(res.body.message).toContain('correo');
    });

    it('un cuerpo vacío devuelve un mensaje en español por cada campo que falta', async () => {
      const res = await app.post('/portal/auth/login', { body: {} });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(res.body.details.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('POST /portal/tickets', () => {
    const validBody = { subject: 'Algo falla', description: 'Detalle del problema' };

    it('un asunto demasiado largo devuelve un mensaje en español sin nombres internos', async () => {
      const res = await app.post('/portal/tickets', {
        token,
        body: { ...validBody, subject: 'x'.repeat(241) },
      });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(res.body.message).toContain('240');
      // El literal de serie era «subject must be shorter than or equal to 240
      // characters»: nombre interno de la columna incluido.
      expect(res.body.message).not.toContain('subject');
    });

    it('una descripción vacía devuelve un mensaje en español', async () => {
      const res = await app.post('/portal/tickets', {
        token,
        body: { ...validBody, description: '' },
      });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(res.body.message.toLowerCase()).toContain('descripción');
    });

    it('un systemId que no es entero devuelve un mensaje en español', async () => {
      const res = await app.post('/portal/tickets', {
        token,
        body: { ...validBody, systemId: 'no-es-un-numero' },
      });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(res.body.message.toLowerCase()).toContain('sistema');
    });

    /**
     * §4.2 de la spec: un endpoint del portal que acepte un `clientId` es un
     * fallo de seguridad. El `ValidationPipe` lo rechaza, pero al hacerlo
     * devolvía «property clientId should not exist», que le confirma al
     * atacante el nombre exacto de la propiedad que estaba buscando.
     */
    it('un campo no declarado se rechaza sin decir cuál era', async () => {
      const res = await app.post('/portal/tickets', {
        token,
        body: { ...validBody, clientId: 99 },
      });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(JSON.stringify(res.body)).not.toContain('clientId');
    });

    it('varios errores a la vez salen separados y no pegados', async () => {
      const res = await app.post('/portal/tickets', {
        token,
        body: { subject: '', description: '' },
      });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details.length).toBe(2);
      // Cada mensaje sigue siendo legible dentro del texto concatenado: no
      // aparece «…obligatorio.La descripción…» pegado sin espacio.
      for (const detail of res.body.details) {
        expect(res.body.message).toContain(detail);
      }
      expect(res.body.message).not.toMatch(/[.!?][A-ZÁÉÍÓÚÑ]/);
    });
  });

  describe('GET /portal/tickets/:id', () => {
    it('un id que no es número devuelve { code, message } en español', async () => {
      const res = await app.get('/portal/tickets/abc', { token });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(typeof res.body.message).toBe('string');
      // El literal de ParseIntPipe es «Validation failed (numeric string is
      // expected)»: inglés y jerga de framework.
      expect(res.body.message.toLowerCase()).not.toContain('validation failed');
      expect(res.body.message.toLowerCase()).not.toContain('numeric string');
      expect(res.body.message.toLowerCase()).toContain('ticket');
    });

    it('un id válido sigue llegando al servicio', async () => {
      const res = await app.get('/portal/tickets/12', { token });
      expect(res.status).toBe(200);
    });
  });
});
