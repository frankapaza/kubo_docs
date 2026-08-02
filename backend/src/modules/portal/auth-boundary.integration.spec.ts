import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { TicketsController } from '../tickets/tickets.controller';
import { TicketsService } from '../tickets/tickets.service';
import { TicketTransitionsService } from '../tickets/ticket-transitions.service';
import { TicketAssignmentService } from '../tickets/ticket-assignment.service';
import { TicketAIService } from '../tickets/ticket-ai.service';
import { ClientUsersController } from './client-users.controller';
import { ClientUsersService } from './client-users.service';
import { PortalTicketsController } from './portal-tickets.controller';
import { PortalTicketsService } from './portal-tickets.service';
import { ClientJwtStrategy } from './strategies/client-jwt.strategy';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';

/**
 * §7 de la spec, bloque de integración: «Ese último bloque es el que justifica
 * la fase: son las pruebas que demuestran que la frontera existe de verdad».
 *
 * Las tres que pide son:
 *
 *   1. Un token de cliente NO valida contra la estrategia del personal.
 *   2. Un token de personal NO valida contra la del portal.
 *   3. `StaffOnlyGuard` rechaza un token de cliente en un endpoint interno.
 *
 * Hasta aquí solo existía la tercera, y como test unitario con un
 * `ExecutionContext` de mentira (`staff-only.guard.spec.ts`): comprobaba la
 * clase del guard, no que estuviera montada en ningún sitio. Con eso, cambiar
 * `JWT_CLIENT_ACCESS_SECRET` por `JWT_ACCESS_SECRET` en `ClientJwtStrategy`, o
 * quitar `@UseGuards(..., StaffOnlyGuard)` de un controlador interno, dejaba la
 * suite entera en verde.
 *
 * Por eso esto levanta controladores **reales** —no dobles con guards
 * decorativos— sobre un servidor HTTP real, y firma tokens de verdad con cada
 * secreto. Los servicios van mockeados: son el lado de allá de la frontera y lo
 * que se prueba es justamente que no se llega a ellos.
 *
 * Los controladores internos que se montan son dos a propósito:
 *
 *   - `TicketsController`, el más representativo del panel.
 *   - `ClientUsersController`, que vive en el propio módulo del portal y es el
 *     candidato más probable a perder su `StaffOnlyGuard` en un refactor.
 *
 * Los dos bloques de abajo montan aplicaciones distintas y **no pueden vivir a
 * la vez**: passport registra las estrategias por nombre en un singleton del
 * proceso, así que dos estrategias 'jwt' se pisarían. Cada bloque cierra su
 * aplicación en su `afterAll` antes de que el siguiente abra la suya.
 */

const STAFF_ACCESS_SECRET = 'secreto-de-pruebas-del-personal';
const CLIENT_ACCESS_SECRET = 'secreto-de-pruebas-del-portal';

const jwt = new JwtService({});

/** Payload que emite `PortalAuthService` para un usuario de cliente. */
const CLIENT_PAYLOAD = {
  sub: 42,
  email: 'portal.test@clienteprueba.pe',
  clientId: 7,
  isClientAdmin: false,
};

/** Payload que emite `AuthService` para un miembro del equipo. */
const STAFF_PAYLOAD = { sub: 1, email: 'admin@kubo.pe', role: 'ADMIN' };

const sign = (payload: object, secret: string) => jwt.sign(payload, { secret, expiresIn: '5m' });

describe('Frontera personal / cliente — las dos estrategias (integración HTTP)', () => {
  let app: TestHttpApp;

  /** Espías sobre lo que hay al otro lado: no deben llamarse nunca en los cruces. */
  let ticketsList: jest.Mock;
  let clientUsersList: jest.Mock;
  let portalList: jest.Mock;

  beforeAll(async () => {
    ticketsList = jest.fn().mockResolvedValue([{ id: 1, code: 'TCK-1' }]);
    clientUsersList = jest.fn().mockResolvedValue([]);
    portalList = jest.fn().mockResolvedValue([{ id: 1, code: 'TCK-1' }]);

    const config = {
      get: (key: string, fallback?: string) =>
        ({
          JWT_ACCESS_SECRET: STAFF_ACCESS_SECRET,
          JWT_CLIENT_ACCESS_SECRET: CLIENT_ACCESS_SECRET,
        })[key] ?? fallback,
    };

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [TicketsController, ClientUsersController, PortalTicketsController],
      providers: [
        { provide: ConfigService, useValue: config },
        // Las dos estrategias reales, registradas a la vez en el mismo
        // servidor: es la única forma de comprobar que no se solapan.
        JwtStrategy,
        ClientJwtStrategy,
        { provide: TicketsService, useValue: { list: ticketsList, findWithTimeline: jest.fn() } },
        { provide: TicketTransitionsService, useValue: {} },
        { provide: TicketAssignmentService, useValue: {} },
        { provide: TicketAIService, useValue: {} },
        { provide: ClientUsersService, useValue: { listByClient: clientUsersList } },
        { provide: PortalTicketsService, useValue: { list: portalList } },
      ],
    }).compile();

    app = await startTestHttpApp(moduleRef);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    ticketsList.mockClear();
    clientUsersList.mockClear();
    portalList.mockClear();
  });

  const clientToken = () => sign(CLIENT_PAYLOAD, CLIENT_ACCESS_SECRET);
  const staffToken = () => sign(STAFF_PAYLOAD, STAFF_ACCESS_SECRET);

  /**
   * Control positivo. Sin esto, los cruces de abajo podrían estar pasando por
   * una ruta mal escrita (404) o un controlador que no arrancó, y no nos
   * enteraríamos: un 401 y un 404 se parecen mucho cuando solo miras el rojo.
   */
  describe('control positivo: cada token funciona en su lado', () => {
    it('un token de personal entra en un endpoint interno', async () => {
      const res = await app.get('/tickets', { token: staffToken() });
      expect(res.status).toBe(200);
      expect(ticketsList).toHaveBeenCalledTimes(1);
    });

    it('un token de personal entra en el otro endpoint interno', async () => {
      const res = await app.get('/client-users?clientId=7', { token: staffToken() });
      expect(res.status).toBe(200);
      expect(clientUsersList).toHaveBeenCalledTimes(1);
    });

    it('un token de cliente entra en el portal', async () => {
      const res = await app.get('/portal/tickets', { token: clientToken() });
      expect(res.status).toBe(200);
      // El clientId sale del token, nunca de la petición (§4.3 de la spec).
      expect(portalList).toHaveBeenCalledWith(7);
    });
  });

  describe('1. un token de cliente no valida contra la estrategia del personal', () => {
    it('GET /tickets con un token firmado con el secreto de cliente devuelve 401', async () => {
      const res = await app.get('/tickets', { token: clientToken() });

      // 401 y no 403: la firma no valida, así que la petición muere en
      // `JwtAuthGuard` sin llegar siquiera a `StaffOnlyGuard`. Si esto pasara a
      // 403, significaría que la barrera criptográfica ha caído y solo queda la
      // explícita — que es exactamente lo que hay que detectar.
      expect(res.status).toBe(401);
      expect(ticketsList).not.toHaveBeenCalled();
    });

    it('GET /client-users con un token firmado con el secreto de cliente devuelve 401', async () => {
      const res = await app.get('/client-users?clientId=7', { token: clientToken() });

      expect(res.status).toBe(401);
      expect(clientUsersList).not.toHaveBeenCalled();
    });
  });

  describe('2. un token de personal no valida contra la estrategia del portal', () => {
    it('GET /portal/tickets con un token firmado con el secreto del personal devuelve 401', async () => {
      const res = await app.get('/portal/tickets', { token: staffToken() });

      expect(res.status).toBe(401);
      expect(portalList).not.toHaveBeenCalled();
    });

    it('tampoco pasa un token de personal que lleve un clientId en el payload', async () => {
      const forged = sign({ ...STAFF_PAYLOAD, clientId: 7 }, STAFF_ACCESS_SECRET);

      const res = await app.get('/portal/tickets', { token: forged });

      expect(res.status).toBe(401);
      expect(portalList).not.toHaveBeenCalled();
    });
  });

  describe('3. un token de cliente en un endpoint interno: nunca 200', () => {
    it.each([['/tickets'], ['/client-users?clientId=7']])(
      'GET %s no devuelve 200 ni datos',
      async (path) => {
        const res = await app.get(path, { token: clientToken() });

        expect(res.status).not.toBe(200);
        expect([401, 403]).toContain(res.status);
        expect(ticketsList).not.toHaveBeenCalled();
        expect(clientUsersList).not.toHaveBeenCalled();
      },
    );
  });

  describe('sin token no entra nadie a ninguno de los dos lados', () => {
    it.each([['/tickets'], ['/client-users?clientId=7'], ['/portal/tickets']])(
      'GET %s sin Authorization devuelve 401',
      async (path) => {
        const res = await app.get(path);
        expect(res.status).toBe(401);
      },
    );
  });
});

/**
 * Estrategia 'jwt' que devuelve el payload entero en vez de la lista blanca
 * `{ id, email, role }` de `JwtStrategy`.
 *
 * No es un atajo: es lo que hace falta para poder ejercer `StaffOnlyGuard` de
 * verdad. Con la estrategia real, un token de cliente nunca llega hasta el
 * segundo guard (la firma no valida, 401), y si se cruzan los secretos para que
 * llegue, `JwtStrategy.validate()` descarta el `clientId` y `StaffOnlyGuard` ya
 * no tiene nada que mirar — lo comprobamos: en ese escenario `/tickets`
 * responde 200. Ese agujero es conocido, está documentado en
 * `JwtSecretsValidator` y su mitigación es abortar el arranque si dos secretos
 * coinciden, no el guard.
 *
 * Lo que sí puede probarse aquí, y hoy no lo prueba nada, es que
 * `StaffOnlyGuard` **está montado** en estos controladores: en cuanto llega una
 * petición autenticada cuyo usuario trae `clientId`, la corta. Quitar el guard
 * de cualquiera de los dos controladores pone estos tests en rojo.
 */
@Injectable()
class PayloadPassthroughJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: STAFF_ACCESS_SECRET,
    });
  }

  validate(payload: Record<string, unknown>): Record<string, unknown> {
    return payload;
  }
}

describe('Frontera personal / cliente — StaffOnlyGuard montado (integración HTTP)', () => {
  let app: TestHttpApp;
  let ticketsList: jest.Mock;
  let clientUsersList: jest.Mock;

  beforeAll(async () => {
    ticketsList = jest.fn().mockResolvedValue([{ id: 1, code: 'TCK-1' }]);
    clientUsersList = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [TicketsController, ClientUsersController],
      providers: [
        PayloadPassthroughJwtStrategy,
        { provide: TicketsService, useValue: { list: ticketsList, findWithTimeline: jest.fn() } },
        { provide: TicketTransitionsService, useValue: {} },
        { provide: TicketAssignmentService, useValue: {} },
        { provide: TicketAIService, useValue: {} },
        { provide: ClientUsersService, useValue: { listByClient: clientUsersList } },
      ],
    }).compile();

    app = await startTestHttpApp(moduleRef);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    ticketsList.mockClear();
    clientUsersList.mockClear();
  });

  /** Control positivo: con el guard montado, el personal sigue entrando. */
  it.each([
    ['/tickets', () => ticketsList],
    ['/client-users?clientId=7', () => clientUsersList],
  ])('GET %s deja pasar a un usuario del equipo', async (path, spy) => {
    const res = await app.get(path, { token: sign(STAFF_PAYLOAD, STAFF_ACCESS_SECRET) });

    expect(res.status).toBe(200);
    expect(spy()).toHaveBeenCalledTimes(1);
  });

  it.each([['/tickets'], ['/client-users?clientId=7']])(
    'GET %s rechaza con 403 a un usuario autenticado que trae clientId',
    async (path) => {
      const res = await app.get(path, { token: sign(CLIENT_PAYLOAD, STAFF_ACCESS_SECRET) });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Esta sección es solo para el equipo interno.',
      });
      expect(ticketsList).not.toHaveBeenCalled();
      expect(clientUsersList).not.toHaveBeenCalled();
    },
  );
});
