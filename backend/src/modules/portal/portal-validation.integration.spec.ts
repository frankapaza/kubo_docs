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
import { PortalRequirementsController } from './portal-requirements.controller';
import { PortalRequirementsService } from './portal-requirements.service';
import { PortalReportsController } from './portal-reports.controller';
import { PortalReportsService } from './portal-reports.service';
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
  let adminToken: string;
  // Con nombre, y no un `jest.fn()` anónimo dentro del `useValue`: las dos
  // pruebas de `ClientAdminGuard` de más abajo necesitan comprobar que jamás
  // se llama, que es la única forma de distinguir «cortado por el guard» de
  // «cortado por casualidad en otro sitio».
  let requirementsCreate: jest.Mock;
  // Con nombre, igual que `requirementsCreate`: la ronda de correcciones 1
  // necesita comprobar *con qué argumento* se llamó, no solo que se llamó —
  // es la única forma de distinguir «el controlador pasa clientId» de «el
  // controlador pasa clientUserId», dos campos contiguos de `AuthClientUser`
  // que otros controladores del portal sí usan juntos.
  let reportsMonthly: jest.Mock;

  beforeAll(async () => {
    requirementsCreate = jest.fn().mockResolvedValue({ id: 1 });
    reportsMonthly = jest.fn().mockResolvedValue({ period: { year: 2026, month: 7 } });

    const config = {
      get: (key: string, fallback?: string) =>
        ({ JWT_CLIENT_ACCESS_SECRET: CLIENT_ACCESS_SECRET })[key] ?? fallback,
    };

    const moduleRef = await Test.createTestingModule({
      // El throttler de `PortalAuthController` no es el objeto de esta prueba,
      // pero sin él el controlador no se puede instanciar.
      imports: [PassportModule, ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS })],
      controllers: [
        PortalAuthController,
        PortalTicketsController,
        PortalRequirementsController,
        PortalReportsController,
      ],
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
        {
          provide: PortalRequirementsService,
          useValue: {
            list: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue({ id: 1 }),
            create: requirementsCreate,
          },
        },
        {
          provide: PortalReportsService,
          useValue: { monthly: reportsMonthly },
        },
      ],
    }).compile();

    app = await startTestHttpApp(moduleRef);

    token = new JwtService({}).sign(
      { sub: 42, email: 'portal.test@clienteprueba.pe', clientId: 7, isClientAdmin: false },
      { secret: CLIENT_ACCESS_SECRET, expiresIn: '5m' },
    );

    // El alta de requerimientos exige `ClientAdminGuard`: con el token de
    // arriba (isClientAdmin: false) esas pruebas verían un 403 y nunca
    // llegarían al ValidationPipe, que es lo que este fichero vigila.
    adminToken = new JwtService({}).sign(
      { sub: 43, email: 'portal.admin@clienteprueba.pe', clientId: 7, isClientAdmin: true },
      { secret: CLIENT_ACCESS_SECRET, expiresIn: '5m' },
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    requirementsCreate.mockClear();
    reportsMonthly.mockClear();
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

  describe('POST /portal/requerimientos', () => {
    const validBody = { title: 'Exportar el listado a Excel', descriptionMd: 'Desde la pantalla de tickets' };

    it('un título demasiado largo devuelve un mensaje en español sin nombres internos', async () => {
      const res = await app.post('/portal/requerimientos', {
        token: adminToken,
        body: { ...validBody, title: 'x'.repeat(241) },
      });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(res.body.message).toContain('240');
      // El literal de serie era «title must be shorter than or equal to 240
      // characters»: nombre interno de la propiedad incluido.
      expect(res.body.message).not.toContain('title');
    });

    it('una descripción vacía devuelve un mensaje en español', async () => {
      const res = await app.post('/portal/requerimientos', {
        token: adminToken,
        body: { ...validBody, descriptionMd: '' },
      });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(res.body.message.toLowerCase()).toContain('descripción');
    });

    /**
     * §4.2 de la spec: un endpoint del portal que acepte un `clientId` es un
     * fallo de seguridad. El `ValidationPipe` lo rechaza, pero al hacerlo
     * devolvía «property clientId should not exist», que le confirma al
     * atacante el nombre exacto de la propiedad que estaba buscando.
     */
    it('un campo no declarado se rechaza sin decir cuál era', async () => {
      const res = await app.post('/portal/requerimientos', {
        token: adminToken,
        body: { ...validBody, clientId: 99 },
      });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(JSON.stringify(res.body)).not.toContain('clientId');
    });

    it('varios errores a la vez salen separados y no pegados', async () => {
      const res = await app.post('/portal/requerimientos', {
        token: adminToken,
        body: { title: '', descriptionMd: '' },
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

    /**
     * Ronda de correcciones 1: hasta aquí, las cuatro pruebas de arriba usan
     * siempre `adminToken`, así que quitar `@UseGuards(ClientAdminGuard)` del
     * `@Post()` del controlador dejaría la suite entera en verde — la
     * mutación que abre el alta a cualquier usuario de la empresa no la
     * vería nadie. El cuerpo es **válido** a propósito: con uno inválido, un
     * fallo de orden entre el guard y el `ValidationPipe` daría 400 en vez
     * de 403 y la prueba no distinguiría «denegado por rol» de «rechazado
     * por forma».
     */
    it('un token que no es de administrador no puede crear un requerimiento', async () => {
      const res = await app.post('/portal/requerimientos', { token, body: validBody });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Solo el administrador de la empresa puede crear requerimientos.',
      });
      expect(requirementsCreate).not.toHaveBeenCalled();
    });

    it('sin token no se puede crear un requerimiento', async () => {
      const res = await app.post('/portal/requerimientos', { body: validBody });

      expect(res.status).toBe(401);
      expect(requirementsCreate).not.toHaveBeenCalled();
    });
  });

  describe('GET /portal/requerimientos/:id', () => {
    it('un id que no es número devuelve { code, message } en español', async () => {
      const res = await app.get('/portal/requerimientos/abc', { token });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(typeof res.body.message).toBe('string');
      // El literal de ParseIntPipe es «Validation failed (numeric string is
      // expected)»: inglés y jerga de framework.
      expect(res.body.message.toLowerCase()).not.toContain('validation failed');
      expect(res.body.message.toLowerCase()).not.toContain('numeric string');
      expect(res.body.message.toLowerCase()).toContain('requerimiento');
    });

    it('un id válido sigue llegando al servicio', async () => {
      // Leer queda abierto a cualquier usuario de la empresa, no solo al
      // administrador: por eso este id válido usa el token normal.
      const res = await app.get('/portal/requerimientos/12', { token });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /portal/informes/mensual', () => {
    const validQuery = 'year=2026&month=7&scope=AMBOS';

    it('un alcance que no es tickets, requerimientos ni ambos devuelve un mensaje en español', async () => {
      const res = await app.get('/portal/informes/mensual?year=2026&month=7&scope=TODO', { token });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(res.body.message.toLowerCase()).toContain('alcance');
    });

    it('un mes fuera de rango devuelve un mensaje en español', async () => {
      const res = await app.get('/portal/informes/mensual?year=2026&month=13&scope=AMBOS', { token });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
      expect(res.body.message).toContain('1 y 12');
    });

    /**
     * Mismo motivo que en `/portal/tickets` y `/portal/requerimientos`: el
     * rechazo no puede confirmarle a quien lo intente que acertó con el
     * nombre de la propiedad.
     *
     * La comprobación se queda en `message`/`details` (lo que hace
     * `expectSpanishValidationError`) y no repite el `JSON.stringify(res.body)`
     * que sí usan esas dos rutas: aquí el parámetro no declarado viaja en la
     * *query*, y `HttpExceptionFilter` siempre copia `req.url` —query
     * incluida— al campo `path` de cualquier error, en cualquier ruta. Eso no
     * es un nombre interno confirmado por el servidor: es la propia URL que
     * el cliente ya escribió, y pedir que desaparezca de `path` sería exigirle
     * a esta ruta un comportamiento que ninguna otra tiene ni necesita.
     */
    it('un parámetro no declarado se rechaza sin decir cuál era', async () => {
      const res = await app.get(`/portal/informes/mensual?${validQuery}&clientId=99`, { token });

      expect(res.status).toBe(400);
      expectSpanishValidationError(res.body);
    });

    it('una consulta válida sigue llegando al servicio', async () => {
      const res = await app.get(`/portal/informes/mensual?${validQuery}`, { token });
      expect(res.status).toBe(200);
    });

    /**
     * Ronda de correcciones 1: la prueba de arriba solo comprobaba el status,
     * y eso deja pasar un cambio de `user.clientId` por `user.clientUserId`
     * en el controlador — son campos contiguos de `AuthClientUser`, y otros
     * controladores del portal los usan **los dos juntos y en ese orden**
     * (`PortalRequirementsController.create`), así que el descuido es
     * completamente plausible. El token de este fichero tiene `sub: 42` y
     * `clientId: 7` justamente para que ambos valores sean distinguibles: si
     * el controlador llegara a pasar `clientUserId` (42) en vez de `clientId`
     * (7), esta aserción falla y delata que una empresa podría descargar el
     * informe de otra.
     */
    it('pasa el clientId de la sesión al servicio, no el clientUserId', async () => {
      const res = await app.get(`/portal/informes/mensual?${validQuery}`, { token });

      expect(res.status).toBe(200);
      expect(reportsMonthly).toHaveBeenCalledWith(7, expect.objectContaining({ year: 2026, month: 7 }));
    });

    it('sin token no se puede descargar el informe', async () => {
      const res = await app.get(`/portal/informes/mensual?${validQuery}`, {});
      expect(res.status).toBe(401);
    });
  });
});
