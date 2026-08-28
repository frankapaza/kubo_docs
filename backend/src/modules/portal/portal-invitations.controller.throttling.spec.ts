import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { THROTTLED_MESSAGE } from '../../common/guards/api-throttler.guard';
import {
  PORTAL_AUTH_THROTTLERS,
  PORTAL_INVITATION_THROTTLE,
  THROTTLER_BURST,
  THROTTLER_SUSTAINED,
} from '../../config/throttler.config';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { PortalInvitationsController } from './portal-invitations.controller';
import {
  INVITATION_INVALID_MESSAGE,
  PortalInvitationsService,
} from './portal-invitations.service';

/**
 * El tope de intentos de `PortalInvitationsController`, con HTTP de verdad.
 *
 * **Existía sin ninguna prueba**: borrar el `@UseGuards(ApiThrottlerGuard)` y
 * los dos `@Throttle` dejaba la suite entera en verde, y con ellos se iba el
 * único freno de la superficie más expuesta del producto — abierta a
 * internet, sin autenticar, y con una credencial al otro lado. Se calca el
 * patrón de `portal-auth.throttling.spec.ts`: el throttler cuenta por
 * `req.ip`, algo que un `ExecutionContext` simulado no tiene, así que la
 * única forma de probarlo es levantando la aplicación y contando peticiones
 * hasta el rechazo.
 *
 * `PortalInvitationsService` va mockeado —aceptar de verdad necesita base de
 * datos— y eso no debilita nada: lo que se prueba es que el guard corta
 * *antes* de llegar al servicio.
 */
describe('Portal invitaciones — limitación de intentos (integración HTTP)', () => {
  let app: TestHttpApp;
  let accept: jest.Mock;
  let preview: jest.Mock;

  /** Un secreto sintácticamente válido. No importa cuál: el servicio va mockeado. */
  const SECRETO = 'a'.repeat(43);
  const CUERPO = {
    secret: SECRETO,
    password: 'contrasena-larga',
    passwordConfirmation: 'contrasena-larga',
  };

  const enlaceNoValido = () =>
    new BadRequestException({
      code: 'INVITACION_NO_VALIDA',
      message: INVITATION_INVALID_MESSAGE,
    });

  beforeEach(async () => {
    // Las dos rutas fallan con el cuerpo único, que es lo que hace el servicio
    // real ante cualquiera de los siete motivos de invalidez.
    accept = jest.fn().mockRejectedValue(enlaceNoValido());
    preview = jest.fn().mockRejectedValue(enlaceNoValido());

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS })],
      controllers: [PortalInvitationsController],
      providers: [{ provide: PortalInvitationsService, useValue: { accept, preview } }],
    }).compile();

    app = await startTestHttpApp(moduleRef);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('los límites son los del login del portal, no los del refresco', () => {
    expect(PORTAL_INVITATION_THROTTLE).toEqual({
      [THROTTLER_BURST]: { ttl: 60_000, limit: 5 },
      [THROTTLER_SUSTAINED]: { ttl: 900_000, limit: 20 },
    });
  });

  describe('POST /portal/invitaciones/aceptar', () => {
    it('deja pasar los 5 primeros intentos y corta el sexto con 429', async () => {
      for (let intento = 1; intento <= 5; intento++) {
        const res = await app.post('/portal/invitaciones/aceptar', { body: CUERPO });
        expect(res.status).toBe(400);
      }

      const cortado = await app.post('/portal/invitaciones/aceptar', { body: CUERPO });
      expect(cortado.status).toBe(429);
      expect(cortado.body).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: THROTTLED_MESSAGE,
      });
      // Nada del throttler de serie se cuela: ni el nombre de su excepción ni
      // el 'INTERNAL_ERROR' que le pondría el filtro por no traer `code`.
      expect(JSON.stringify(cortado.body)).not.toContain('ThrottlerException');
    });

    it('el guard corta antes de tocar el servicio: la sexta no llega a `accept`', async () => {
      for (let intento = 1; intento <= 6; intento++) {
        await app.post('/portal/invitaciones/aceptar', { body: CUERPO });
      }
      expect(accept).toHaveBeenCalledTimes(5);
    });

    /**
     * Falla cerrado por construcción: el guard corre ANTES del pipe, así que
     * un cuerpo malformado consume intento igual que uno bueno. Sin esto,
     * bastaría con mandar basura para probar enlaces sin gastar cuota.
     */
    it('un cuerpo malformado también consume intentos', async () => {
      for (let intento = 1; intento <= 5; intento++) {
        const res = await app.post('/portal/invitaciones/aceptar', { body: { secret: 1 } });
        expect(res.status).toBe(400);
      }

      const cortado = await app.post('/portal/invitaciones/aceptar', { body: CUERPO });
      expect(cortado.status).toBe(429);
    });
  });

  describe('GET /portal/invitaciones/:secret', () => {
    /**
     * La vista previa no escribe nada, pero es una superficie sin autenticar
     * sobre el mismo secreto: sin tope sería la vía barata para probar
     * enlaces, la que aceptar sí tiene cerrada.
     */
    it('deja pasar los 5 primeros intentos y corta el sexto con 429', async () => {
      for (let intento = 1; intento <= 5; intento++) {
        const res = await app.get(`/portal/invitaciones/${SECRETO}`);
        expect(res.status).toBe(400);
      }

      const cortado = await app.get(`/portal/invitaciones/${SECRETO}`);
      expect(cortado.status).toBe(429);
      expect(cortado.body).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: THROTTLED_MESSAGE,
      });
    });

    it('el guard corta antes de tocar el servicio: la sexta no llega a `preview`', async () => {
      for (let intento = 1; intento <= 6; intento++) {
        await app.get(`/portal/invitaciones/${SECRETO}`);
      }
      expect(preview).toHaveBeenCalledTimes(5);
    });

    /**
     * El contador va por IP y NUNCA por el secreto: contar por secreto
     * permitiría distinguir un enlace que existe de uno que no según cuál
     * empezara a devolver 429 antes, deshaciendo el trabajo de que todos los
     * fallos respondan lo mismo.
     */
    it('el contador es por dirección de origen, no por secreto: cambiar de enlace no lo reinicia', async () => {
      for (let intento = 1; intento <= 5; intento++) {
        await app.get(`/portal/invitaciones/${SECRETO}`);
      }

      const otro = await app.get(`/portal/invitaciones/${'b'.repeat(43)}`);
      expect(otro.status).toBe(429);
    });
  });

  /**
   * EL MATIZ QUE EL COMENTARIO NO PODÍA PROMETER. Las dos rutas llevan los
   * mismos límites, pero `ThrottlerGuard.generateKey` mete el nombre del
   * manejador en la clave, así que cada una lleva su cuenta aparte: desde una
   * misma IP salen 5 aceptaciones por minuto MÁS 5 vistas previas, no 5 entre
   * las dos. Es la misma propiedad que ya tiene el par login/refresco del
   * portal, y se deja así —forzar un contador común obligaría a sobreescribir
   * `generateKey` solo para este par, y 10/minuto sigue siendo un techo
   * irrelevante frente a un secreto de 32 bytes al azar—. Lo que no se deja
   * es la promesa a medias: si el número importa, el número es 10.
   */
  it('cada ruta lleva su propio contador: agotar aceptar no bloquea la vista previa', async () => {
    for (let intento = 1; intento <= 6; intento++) {
      await app.post('/portal/invitaciones/aceptar', { body: CUERPO });
    }
    const bloqueada = await app.post('/portal/invitaciones/aceptar', { body: CUERPO });
    expect(bloqueada.status).toBe(429);

    const vistaPrevia = await app.get(`/portal/invitaciones/${SECRETO}`);
    expect(vistaPrevia.status).toBe(400);
  });
});
