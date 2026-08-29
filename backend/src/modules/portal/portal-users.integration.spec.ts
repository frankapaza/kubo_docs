import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { PORTAL_AUTH_THROTTLERS } from '../../config/throttler.config';
import { UNEXPECTED_PROPERTY_MESSAGE } from '../../common/validation/validation-pipe.factory';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { ClientJwtStrategy } from './strategies/client-jwt.strategy';
import { PortalUsersController } from './portal-users.controller';
import { PortalUsersService } from './portal-users.service';
import { PortalInvitationsController } from './portal-invitations.controller';
import {
  INVITATION_INVALID_MESSAGE,
  INVITE_REJECTED_MESSAGE,
  PortalInvitationsService,
} from './portal-invitations.service';

/**
 * La frontera de la gestión de usuarios desde el portal, atravesando el ciclo
 * completo: guard de sesión → guard de administrador → `ValidationPipe` →
 * controlador → `HttpExceptionFilter`.
 *
 * Las pruebas de servicio comprueban las reglas; estas comprueban que están
 * MONTADAS. Sin ellas, quitar `@UseGuards(ClientJwtGuard, ClientAdminGuard)`
 * del controlador dejaría la suite en verde. Mismo argumento, y mismo
 * andamiaje, que `auth-boundary.integration.spec.ts`.
 *
 * **Sobre el tope de intentos de `POST /portal/usuarios/invitaciones` y de
 * `POST /portal/invitaciones/aceptar` / `GET /portal/invitaciones/:secret`**:
 * esas dos superficies YA tienen su propia prueba de integración HTTP contra
 * el rechazo real por exceso de intentos —
 * `portal-users.controller.invite-throttling.spec.ts` y
 * `portal-invitations.controller.throttling.spec.ts`—, así que no se repite
 * aquí. Importa: el `app` de este fichero se levanta UNA sola vez en
 * `beforeAll` y las tres rutas que llevan `ApiThrottlerGuard` comparten
 * contador (por IP) durante TODO este fichero, no por `it`. El número de
 * llamadas con sesión de administrador a `POST /portal/usuarios/invitaciones`
 * y a `POST /portal/invitaciones/aceptar` está calculado a propósito para no
 * pasar de 5 —el límite de ráfaga (`PORTAL_AUTH_THROTTLERS` /
 * `PORTAL_INVITATION_THROTTLE`, ambos 5/min)— entre TODAS las pruebas de este
 * fichero: añadir una llamada más a cualquiera de las dos convertiría esa
 * llamada en un 429 y rompería la prueba que la reciba, no por un fallo de lo
 * que se prueba sino por agotar la cuota compartida. Quien toque este fichero
 * y necesite una llamada más a esas dos rutas tiene que levantar una
 * `describe` con su propio `app`, no añadirla aquí.
 */

const CLIENT_ACCESS_SECRET = 'secreto-de-pruebas-del-portal';
const jwt = new JwtService({});

function tokenDe(payload: Record<string, unknown>): string {
  return jwt.sign(payload, { secret: CLIENT_ACCESS_SECRET, expiresIn: '5m' });
}

/** Quita del cuerpo lo que cambia entre dos respuestas por fuerza. */
function cuerpoComparable(body: any) {
  const { timestamp, ...resto } = body ?? {};
  return resto;
}

/**
 * Igual que `cuerpoComparable`, y además sin `path`: para comparar el cuerpo
 * de `accept` contra el de `preview` hay que quitar también la ruta, porque
 * las dos rutas son literalmente distintas (`/portal/invitaciones/aceptar`
 * frente a `/portal/invitaciones/<secreto>`) y esa diferencia no es una fuga,
 * es la URL de cada endpoint.
 */
function cuerpoComparableEntreRutas(body: any) {
  const { timestamp, path, ...resto } = body ?? {};
  return resto;
}

describe('Portal — gestión de usuarios (integración HTTP)', () => {
  let app: TestHttpApp;
  let admin: string;
  let normal: string;
  let usersList: jest.Mock;
  let usersDeactivate: jest.Mock;
  let invite: jest.Mock;
  let resend: jest.Mock;
  let accept: jest.Mock;
  let preview: jest.Mock;

  beforeAll(async () => {
    usersList = jest.fn().mockResolvedValue([]);
    usersDeactivate = jest.fn().mockResolvedValue({ id: 5, isActive: false });
    invite = jest.fn().mockResolvedValue({ id: 11 });
    resend = jest.fn().mockResolvedValue({ id: 11 });
    accept = jest.fn().mockResolvedValue({ email: 'nuevo@kuboti.com' });
    preview = jest.fn().mockResolvedValue({ fullName: 'Nuevo Nombre', clientName: 'Acme S.A.C.' });

    const config = {
      get: (key: string, fallback?: string) =>
        ({ JWT_CLIENT_ACCESS_SECRET: CLIENT_ACCESS_SECRET })[key] ?? fallback,
    };

    const moduleRef = await Test.createTestingModule({
      // El throttler no es el objeto de esta prueba, pero sin él
      // `PortalInvitationsController` no se puede instanciar.
      imports: [PassportModule, ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS })],
      controllers: [PortalUsersController, PortalInvitationsController],
      providers: [
        { provide: ConfigService, useValue: config },
        ClientJwtStrategy,
        {
          provide: PortalUsersService,
          useValue: { list: usersList, deactivate: usersDeactivate },
        },
        {
          provide: PortalInvitationsService,
          useValue: {
            invite,
            listPending: jest.fn().mockResolvedValue([]),
            resend,
            accept,
            preview,
          },
        },
      ],
    }).compile();

    app = await startTestHttpApp(moduleRef);
    admin = tokenDe({ sub: 3, email: 'jefe@kuboti.com', clientId: 7, isClientAdmin: true });
    normal = tokenDe({ sub: 4, email: 'curro@kuboti.com', clientId: 7, isClientAdmin: false });
  });

  afterAll(() => app.close());

  describe('las guardas están montadas de verdad', () => {
    it.each([
      ['GET', '/portal/usuarios'],
      ['GET', '/portal/usuarios/invitaciones'],
      ['POST', '/portal/usuarios/invitaciones'],
      ['POST', '/portal/usuarios/5/desactivar'],
      ['POST', '/portal/usuarios/invitaciones/11/reenviar'],
    ])('%s %s sin token responde 401', async (metodo, ruta) => {
      const res = await app.request(metodo, ruta, { body: metodo === 'POST' ? {} : undefined });
      expect(res.status).toBe(401);
    });

    it.each([
      ['GET', '/portal/usuarios'],
      ['POST', '/portal/usuarios/5/desactivar'],
    ])('%s %s con un usuario que no es administrador responde 403', async (metodo, ruta) => {
      const res = await app.request(metodo, ruta, {
        token: normal,
        body: metodo === 'POST' ? {} : undefined,
      });
      expect(res.status).toBe(403);
    });

    it('el servicio ni se llega a tocar cuando el guard corta', async () => {
      usersList.mockClear();
      await app.get('/portal/usuarios', { token: normal });
      expect(usersList).not.toHaveBeenCalled();
    });

    /**
     * Un token manipulado puede traer `1` o `"true"` donde debería ir un
     * booleano. Solo `true` abre la puerta.
     */
    it.each([[1], ['true'], [null]])(
      'un isClientAdmin que no es el booleano true (%s) no pasa',
      async (valor) => {
        const raro = tokenDe({ sub: 4, email: 'x@y.com', clientId: 7, isClientAdmin: valor });
        expect((await app.get('/portal/usuarios', { token: raro })).status).toBe(403);
      },
    );
  });

  describe('la empresa viene de la sesión, no del cuerpo', () => {
    /**
     * LA PRUEBA QUE PIDE LA SPEC, con la petición manipulada y no confiando en
     * el tipo: una empresa ajena en el cuerpo se ignora. Aquí la corta el
     * `ValidationPipe` global con `forbidNonWhitelisted`, que es la segunda
     * barrera; la primera —que el servicio no lo lea aunque llegue— la
     * comprueba `portal-invitations.service.spec.ts`.
     */
    it('un clientId ajeno en el cuerpo del alta se rechaza con el texto genérico', async () => {
      const res = await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'nuevo@kuboti.com', fullName: 'Nuevo', clientId: 99 },
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(UNEXPECTED_PROPERTY_MESSAGE);
      // Y el nombre de la propiedad NO sale en la respuesta: confirmársela al
      // atacante sería regalarle justo lo que estaba buscando.
      expect(JSON.stringify(res.body)).not.toContain('clientId');
    });

    it('nunca llega al servicio una petición con clientId en el cuerpo', async () => {
      invite.mockClear();
      await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'nuevo@kuboti.com', fullName: 'Nuevo', clientId: 99 },
      });
      expect(invite).not.toHaveBeenCalled();
    });

    it('cuando el alta es legítima, el controlador pasa el clientId DEL TOKEN', async () => {
      invite.mockClear();
      await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'nuevo@kuboti.com', fullName: 'Nuevo' },
      });
      expect(invite).toHaveBeenCalledWith(7, 3, expect.objectContaining({
        email: 'nuevo@kuboti.com',
      }));
    });
  });

  describe('no se puede nombrar un administrador desde el portal', () => {
    it('un isAdmin en el alta se rechaza y no llega al servicio', async () => {
      invite.mockClear();
      const res = await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'nuevo@kuboti.com', fullName: 'Nuevo', isAdmin: true },
      });
      expect(res.status).toBe(400);
      expect(invite).not.toHaveBeenCalled();
    });

    it('un isAdmin al aceptar tampoco pasa', async () => {
      accept.mockClear();
      const res = await app.post('/portal/invitaciones/aceptar', {
        body: {
          secret: 'x'.repeat(43),
          password: 'contrasena-larga',
          passwordConfirmation: 'contrasena-larga',
          isAdmin: true,
        },
      });
      expect(res.status).toBe(400);
      expect(accept).not.toHaveBeenCalled();
    });
  });

  describe('la página de aceptar es pública', () => {
    it('acepta una petición SIN ningún token', async () => {
      const res = await app.post('/portal/invitaciones/aceptar', {
        body: {
          secret: 'x'.repeat(43),
          password: 'contrasena-larga',
          passwordConfirmation: 'contrasena-larga',
        },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ email: 'nuevo@kuboti.com' });
    });

    /**
     * Decisión 10 de la spec: SÍ existe una ruta `GET` pública, y es de solo
     * lectura. Antes de esta decisión, la ausencia de cualquier `GET` era la
     * garantía de que aceptar era la única superficie que consumía la
     * invitación; ahora la garantía la da `preview` no escribiendo nada
     * (comprobado en `portal-invitations.preview.spec.ts`), no la ausencia
     * de la ruta.
     */
    it('la vista previa es pública y devuelve el nombre y la empresa', async () => {
      const res = await app.get(`/portal/invitaciones/${'x'.repeat(43)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ fullName: 'Nuevo Nombre', clientName: 'Acme S.A.C.' });
    });

    it('la vista previa no lleva ni correo, ni identificadores, ni fechas', async () => {
      const res = await app.get(`/portal/invitaciones/${'x'.repeat(43)}`);
      expect(Object.keys(res.body).sort()).toEqual(['clientName', 'fullName']);
    });
  });

  describe('todos los fallos al aceptar salen iguales por el cable', () => {
    /**
     * La comprobación de las tareas anteriores es sobre el cuerpo que lanza el
     * servicio. Esta es sobre el JSON que sale de verdad tras el
     * `HttpExceptionFilter`, que añade `statusCode`, `path`, `details` y
     * `timestamp`: si alguno de esos delatara el motivo, el trabajo de igualar
     * los mensajes no habría servido de nada.
     *
     * El servicio real (`portal-invitations.service.ts`) colapsa SIETE
     * motivos de invalidez al mismo `enlaceNoValido()`: no existe, caducada,
     * ya usada, revocada, quien invitó fue desactivado, la empresa dejó de
     * ser cliente, y —el séptimo, añadido tras la revisión de la Tarea 7,
     * ruling R4-8— la dirección ya es de un usuario porque el personal la dio
     * de alta desde el panel mientras la invitación seguía viva. Los siete
     * lanzan literalmente la MISMA excepción, así que basta con repetir la
     * llamada para demostrar que el cuerpo por el cable es indistinguible; no
     * hace falta (ni se puede: ver la nota de cabecera sobre el tope de
     * intentos compartido) una llamada HTTP por motivo.
     */
    it('los siete motivos dan la misma respuesta HTTP, byte a byte salvo la marca de tiempo', async () => {
      const cuerpos: string[] = [];
      let ultima: { status: number; body: any } = { status: 0, body: undefined };
      for (const _motivo of ['no existe', 'caducada', 'ya usada']) {
        accept.mockRejectedValueOnce(
          new BadRequestException({
            code: 'INVITACION_NO_VALIDA',
            message: INVITATION_INVALID_MESSAGE,
          }),
        );
        const res = await app.post('/portal/invitaciones/aceptar', {
          body: {
            secret: 'x'.repeat(43),
            password: 'contrasena-larga',
            passwordConfirmation: 'contrasena-larga',
          },
        });
        ultima = res;
        cuerpos.push(JSON.stringify({ status: res.status, body: cuerpoComparable(res.body) }));
      }
      expect(new Set(cuerpos).size).toBe(1);

      // Y la vista previa, ante el mismo motivo (aquí representado por
      // "revocada", "quien invitó fue desactivado", "la empresa dejó de ser
      // cliente" o el séptimo, "ya es un usuario": los cuatro que quedan de
      // los siete, y con el mismo cuerpo que los tres de arriba), da EXACTAMENTE
      // el mismo cuerpo que aceptar. Si `preview` saludara donde `accept`
      // rechaza —o al revés—, esa divergencia delataría el motivo tan bien
      // como un texto distinto habría hecho, deshaciendo el trabajo de las
      // Tareas 6 y 7.
      preview.mockRejectedValueOnce(
        new BadRequestException({
          code: 'INVITACION_NO_VALIDA',
          message: INVITATION_INVALID_MESSAGE,
        }),
      );
      const resPreview = await app.get(`/portal/invitaciones/${'x'.repeat(43)}`);
      expect(resPreview.status).toBe(ultima.status);
      expect(cuerpoComparableEntreRutas(resPreview.body)).toEqual(
        cuerpoComparableEntreRutas(ultima.body),
      );
    });
  });

  describe('el error de invitar tampoco dice si el correo existe', () => {
    it('sale el texto genérico y ningún dato de la dirección', async () => {
      invite.mockRejectedValueOnce(
        new BadRequestException({
          code: 'INVITACION_RECHAZADA',
          message: INVITE_REJECTED_MESSAGE,
        }),
      );
      const res = await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'yaexiste@otraempresa.com', fullName: 'Nuevo' },
      });
      expect(res.body.message).toBe(INVITE_REJECTED_MESSAGE);
      expect(JSON.stringify(res.body)).not.toContain('otraempresa.com');
    });
  });

  /**
   * `desactivar` y `reenviar` no llevan `ApiThrottlerGuard` (solo `invite` lo
   * lleva, ver el controlador), así que las llamadas de este bloque no tocan
   * el tope de intentos compartido de la nota de cabecera: puede llamarse
   * tantas veces como haga falta.
   *
   * Estas pruebas mockean el servicio con la MISMA excepción que lanza el
   * código real (`PortalUsersService.deactivate` / `noExiste`,
   * `PortalInvitationsService.resend`): lo que comprueban no es la regla de
   * negocio en sí —eso ya lo hacen `portal-users.service.spec.ts` y
   * `portal-invitations.service.spec.ts` con un repositorio de mentira—, sino
   * que el `HttpExceptionFilter` y la cadena de guards reales de esta
   * aplicación entregan esa excepción SIN transformarla: que un
   * `NotFoundException` siga siendo 404 y no se convierta en un 403 por el
   * camino, y que un `BadRequestException` de negocio siga siendo 400. Con
   * solo las pruebas de servicio, un `catch` mal puesto en el controlador que
   * tradujera cualquier error a 403 (por ejemplo) dejaría esa suite entera en
   * verde.
   */
  describe('el recurso de otra empresa da 404, y las guardas de negocio del equipo llegan intactas por HTTP', () => {
    it('desactivar un usuario de otra empresa (o que no existe) responde 404 y no 403', async () => {
      usersDeactivate.mockRejectedValueOnce(
        new NotFoundException({ code: 'NOT_FOUND', message: 'Usuario no encontrado' }),
      );
      const res = await app.post('/portal/usuarios/999/desactivar', { token: admin, body: {} });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
    });

    it('reenviar la invitación de otra empresa (o que no existe) responde 404 y no 403', async () => {
      resend.mockRejectedValueOnce(
        new NotFoundException({ code: 'NOT_FOUND', message: 'Invitación no encontrada' }),
      );
      const res = await app.post('/portal/usuarios/invitaciones/999/reenviar', {
        token: admin,
        body: {},
      });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: 'Invitación no encontrada' });
    });

    /** Decisión 5 de la spec, y su propia prueba (autoexclusión). */
    it('no puede quitarse el acceso a sí mismo: 400, no 403 ni 404', async () => {
      usersDeactivate.mockRejectedValueOnce(
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message:
            'No puedes quitarte a ti mismo el acceso: la empresa se quedaría sin administrador.',
        }),
      );
      const res = await app.post('/portal/usuarios/3/desactivar', { token: admin, body: {} });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        'No puedes quitarte a ti mismo el acceso: la empresa se quedaría sin administrador.',
      );
    });

    /** Decisión 9 de la spec, y su propia prueba (exclusión de otro administrador). */
    it('no puede quitarle el acceso a otro administrador de su empresa: 400, no 403 ni 404', async () => {
      usersDeactivate.mockRejectedValueOnce(
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'No puedes quitarle el acceso a otro administrador de tu empresa.',
        }),
      );
      const res = await app.post('/portal/usuarios/6/desactivar', { token: admin, body: {} });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        'No puedes quitarle el acceso a otro administrador de tu empresa.',
      );
    });
  });
});
