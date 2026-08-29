import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { Repository } from 'typeorm';
import { AuditLog } from '../../modules/audit/entities/audit-log.entity';
import { AuditInterceptor } from './audit.interceptor';

/**
 * El interceptor es global: la misma clase escribe el asiento de una accion
 * del personal (req.user = { id, email, role }) y el de una accion del portal
 * (req.user = AuthClientUser, que NO tiene `id`). Estos tests fijan que las
 * tres procedencias -- personal, cliente y sistema -- queden distinguibles.
 */
const makeInterceptor = () => {
  const saved: Array<Partial<AuditLog>> = [];
  const repo = {
    create: jest.fn((data: Partial<AuditLog>) => data),
    save: jest.fn((data: Partial<AuditLog>) => {
      saved.push(data);
      return Promise.resolve(data);
    }),
  };
  return { interceptor: new AuditInterceptor(repo as unknown as Repository<AuditLog>), repo, saved };
};

const ctxWith = (user: unknown, body: unknown = { subject: 'x' }): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/api/v1/portal/tickets',
        route: { path: '/api/v1/portal/tickets' },
        body,
        headers: {},
        ip: '10.0.0.1',
        user,
      }),
    }),
  }) as unknown as ExecutionContext;

const next: CallHandler = { handle: () => of({ id: 42 }) };

const run = async (user: unknown) => {
  const { interceptor, saved } = makeInterceptor();
  await firstValueFrom(interceptor.intercept(ctxWith(user), next));
  return saved[0];
};

/**
 * El asiento que deja un POST con ese cuerpo (y, si se pide, esa respuesta).
 * Lo que interesa mirar es `payloadJson`, que es lo que acaba escrito en
 * `audit_log` y, por tanto, en cada respaldo de la base.
 */
const asientoDe = async (body: unknown, response: unknown = { id: 42 }) => {
  const { interceptor, saved } = makeInterceptor();
  await firstValueFrom(
    interceptor.intercept(ctxWith({ id: 5 }, body), { handle: () => of(response) }),
  );
  return saved[0].payloadJson as { request: any; response: any };
};

describe('AuditInterceptor: a quien se atribuye la accion', () => {
  it('una accion del personal va en user_id y deja client_user_id nulo', async () => {
    const entry = await run({ id: 5, email: 'admin@kubo.pe', role: 'ADMIN' });
    expect(entry.userId).toBe(5);
    expect(entry.clientUserId).toBeNull();
  });

  it('una accion del portal va en client_user_id y deja user_id nulo', async () => {
    const entry = await run({ clientUserId: 11, email: 'p@c.pe', clientId: 7, isClientAdmin: false });
    expect(entry.userId).toBeNull();
    expect(entry.clientUserId).toBe(11);
  });

  it('nunca mete el clientUserId en user_id: se confundiria con un id de users', async () => {
    const entry = await run({ clientUserId: 5, email: 'p@c.pe', clientId: 7, isClientAdmin: false });
    // El mismo numero como id de personal seria un asiento atribuido a otra
    // persona, ademas de romper la FK audit_log.user_id -> users(id).
    expect(entry.userId).not.toBe(5);
    expect(entry.userId).toBeNull();
  });

  it('una accion sin sesion queda con las dos columnas nulas (sistema)', async () => {
    const entry = await run(undefined);
    expect(entry.userId).toBeNull();
    expect(entry.clientUserId).toBeNull();
  });

  it('los tres asientos son distinguibles entre si', async () => {
    const personal = await run({ id: 5 });
    const cliente = await run({ clientUserId: 5, clientId: 7 });
    const sistema = await run(undefined);
    const huella = (e: Partial<AuditLog>) => `${e.userId ?? '-'}/${e.clientUserId ?? '-'}`;
    expect(new Set([huella(personal), huella(cliente), huella(sistema)]).size).toBe(3);
  });
});

/**
 * EL TACHADO, QUE NO TENIA NINGUNA PRUEBA.
 *
 * Buscar `password|secret|scrub` en este fichero daba cero resultados, y por
 * eso el defecto era invisible: nada falla cuando una contrasena se escribe en
 * claro en `audit_log`. El interceptor es GLOBAL --registra todo POST-- y esa
 * tabla se lee desde el panel y viaja en cada respaldo de la base.
 *
 * El caso que lo destapo es el cuerpo de aceptar una invitacion del portal:
 * trae `secret` (el enlace vivo) y `passwordConfirmation` (que ES la
 * contrasena, porque el servicio exige que las dos sean identicas antes de
 * tocar nada). La lista exacta de cuatro claves que habia aqui antes no
 * cubria ninguna de las dos.
 */
describe('AuditInterceptor: el tachado de lo sensible', () => {
  /** El cuerpo real de `POST /portal/invitaciones/aceptar`. */
  const CUERPO_DE_ACEPTAR = {
    secret: 'enlace-vivo-de-la-invitacion',
    password: 'MiClave2026!',
    passwordConfirmation: 'MiClave2026!',
  };

  it('el cuerpo de aceptar una invitacion no deja ni el secreto ni la contrasena', async () => {
    const payload = await asientoDe(CUERPO_DE_ACEPTAR);

    expect(payload.request).toEqual({
      secret: '***',
      password: '***',
      passwordConfirmation: '***',
    });
    // Y ni el secreto ni la contrasena sobreviven en NINGUN rincon del
    // asiento: es lo que de verdad acaba en la tabla y en el respaldo.
    expect(JSON.stringify(payload)).not.toContain('enlace-vivo-de-la-invitacion');
    expect(JSON.stringify(payload)).not.toContain('MiClave2026!');
  });

  /**
   * Por patron y no por lista exacta. Cada uno de estos nombres sobrevivia a
   * la lista de cuatro claves, y el proximo campo que estrene nombre habria
   * sobrevivido igual: es el defecto que se repite, no una omision suelta.
   */
  it.each([
    'secret',
    'passwordConfirmation',
    'newPassword',
    'currentPassword',
    'apiToken',
    'webhookSecret',
    'clientSecret',
    'idToken',
    'secretFingerprint',
  ])('tacha `%s` aunque no sea ninguna de las cuatro claves de la lista vieja', async (clave) => {
    const payload = await asientoDe({ [clave]: 'valor-que-no-debe-quedar' });
    expect(payload.request[clave]).toBe('***');
    expect(JSON.stringify(payload)).not.toContain('valor-que-no-debe-quedar');
  });

  it('no distingue mayusculas: da igual como se escriba la clave', async () => {
    const payload = await asientoDe({
      Password: 'a-no-guardar',
      SECRET: 'b-no-guardar',
      Refresh_Token: 'c-no-guardar',
      accessTOKEN: 'd-no-guardar',
    });
    expect(Object.values(payload.request)).toEqual(['***', '***', '***', '***']);
    expect(JSON.stringify(payload)).not.toMatch(/no-guardar/);
  });

  /**
   * Contiene, no es igual. Un tachado por igualdad exacta pasaria estas en
   * claro, y son justo la forma que toman los nombres de campo reales.
   */
  it('basta con que la clave CONTENGA la palabra, no con que sea igual', async () => {
    const payload = await asientoDe({
      usuarioPasswordAntigua: 'x1',
      tokenDeRefresco: 'x2',
      elSecretoDelEnlace: 'x3',
    });
    expect(payload.request.usuarioPasswordAntigua).toBe('***');
    expect(payload.request.tokenDeRefresco).toBe('***');
    // Y el nombre en espanol cae tambien, de propina: "secreto" contiene
    // "secret". No es el motivo de que el patron exista --las claves reales
    // de este producto estan en ingles-- pero conviene que quede escrito.
    expect(payload.request.elSecretoDelEnlace).toBe('***');
  });

  /** Tambien en lo anidado: el tachado viejo solo miraba el primer nivel. */
  it('tacha en profundidad, no solo en el primer nivel', async () => {
    const payload = await asientoDe({
      usuario: {
        email: 'ana@kuboti.com',
        credenciales: { password: 'clave-anidada', nested: { refreshToken: 'token-anidado' } },
      },
      lista: [{ password: 'clave-en-lista' }],
    });

    expect(payload.request.usuario.credenciales.password).toBe('***');
    expect(payload.request.usuario.credenciales.nested.refreshToken).toBe('***');
    expect(payload.request.lista[0].password).toBe('***');
    expect(JSON.stringify(payload)).not.toMatch(/clave-anidada|token-anidado|clave-en-lista/);
  });

  /** La respuesta se tacha igual que la peticion: es el otro medio asiento. */
  it('la respuesta tambien se tacha, y tambien en profundidad', async () => {
    const payload = await asientoDe({ subject: 'x' }, { id: 42, sesion: { accessToken: 'jwt-vivo' } });
    expect(payload.response.sesion.accessToken).toBe('***');
    expect(JSON.stringify(payload)).not.toContain('jwt-vivo');
  });

  /**
   * NO es una lista blanca. Tachar todo salvo lo permitido se comeria la
   * auditoria util de todo el sistema --este interceptor es global--, y la
   * auditoria existe justamente para poder leer que se hizo.
   */
  it('lo que no es sensible se guarda tal cual, en todos los niveles', async () => {
    const payload = await asientoDe({
      subject: 'No puedo entrar',
      priority: 3,
      activo: true,
      vacio: null,
      detalle: { clientId: 7, etiquetas: ['soporte', 'urgente'] },
    });

    expect(payload.request).toEqual({
      subject: 'No puedo entrar',
      priority: 3,
      activo: true,
      vacio: null,
      detalle: { clientId: 7, etiquetas: ['soporte', 'urgente'] },
    });
  });

  /**
   * Recorrer el arbol no puede estropear los valores que no son objetos
   * planos: una fecha convertida en `{}` es un dato perdido en el asiento.
   */
  it('las fechas siguen siendo fechas y no se vacian al recorrer', async () => {
    const cuando = new Date('2026-08-26T15:00:00.000Z');
    const payload = await asientoDe({ dueAt: cuando, anidado: { creadoEn: cuando } });
    expect(payload.request.dueAt).toBe(cuando);
    expect(payload.request.anidado.creadoEn).toBe(cuando);
  });

  /**
   * Un ciclo no puede colgar la peticion. Y el corte es por CAMINO, no por
   * "ya visto": un mismo objeto repetido en dos ramas --una entidad
   * compartida-- tiene que salir entero las dos veces.
   */
  it('un ciclo se corta sin colgarse, y un objeto repetido en dos ramas sale entero', async () => {
    const ciclo: any = { nombre: 'raiz' };
    ciclo.self = ciclo;
    const compartido = { valor: 'compartido' };

    const payload = await asientoDe({ ciclo, a: compartido, b: compartido });

    expect(payload.request.ciclo.self).toBe('[circular]');
    expect(payload.request.a).toEqual({ valor: 'compartido' });
    expect(payload.request.b).toEqual({ valor: 'compartido' });
  });
});
