import { BadRequestException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { INVITE_REJECTED_MESSAGE, PortalInvitationsService } from './portal-invitations.service';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

function makeService(opciones: {
  usuarioExistente?: any;
  invitacionViva?: any;
  pendiente?: any;
  envioFalla?: unknown;
  /** Fuerza el fallo del envío aunque `envioFalla` sea `undefined`. */
  envioRechaza?: boolean;
  /** Simula un fallo a mitad de la transacción de revocar+crear (finding B). */
  fallaEn?: 'revocar' | 'crear';
} = {}) {
  const escritas: any[] = [];
  const revocadas: any[] = [];
  const enviados: any[] = [];
  const marcados: any[] = [];
  const ordenDeEscritura: string[] = [];

  /**
   * Lo que escribe `manager.getRepository(...)` dentro de la transacción de
   * revocar+crear. Se acumula aquí y solo pasa a `escritas`/`revocadas` —lo
   * que miran las pruebas— cuando el callback de `runInTransaction` termina
   * bien, igual que un COMMIT. Si lanza, no se vuelca nada: así se comprueba
   * que un fallo a mitad no deja ni la revocación ni la creación. Mismo
   * criterio que el doble de `portal-invitations.accept.spec.ts`.
   */
  const pendientes = { escritas: [] as any[], revocadas: [] as any[] };

  const manager = {
    getRepository: () => ({
      create: (d: any) => d,
      save: async (d: any) => {
        ordenDeEscritura.push('crear');
        if (opciones.fallaEn === 'crear') throw new Error('fallo al crear la invitación');
        const fila = {
          id: 11, usedAt: null, revokedAt: null, lastSentAt: null, sendError: null,
          createdAt: new Date('2026-08-26T15:00:00.000Z'), ...d,
        };
        pendientes.escritas.push(fila);
        return fila;
      },
      update: async (where: any, patch: any) => {
        ordenDeEscritura.push('revocar');
        if (opciones.fallaEn === 'revocar') throw new Error('fallo al revocar la invitación');
        pendientes.revocadas.push([where, patch]);
        return { affected: 1 };
      },
    }),
  };

  const invitations = {
    escritas, revocadas, marcados, ordenDeEscritura,
    runInTransaction: jest.fn(async (work: (m: any) => Promise<unknown>) => {
      const r = await work(manager);
      escritas.push(...pendientes.escritas);
      revocadas.push(...pendientes.revocadas);
      return r;
    }),
    // El repositorio inyectado. Tras el arreglo de la atomicidad (revisión,
    // finding B) ya no debería usarse para escribir: si alguna prueba lo ve
    // invocado, la transacción se deshizo y se volvió a las dos escrituras
    // sueltas. Si a pesar de eso algo lo invocara, sus efectos son
    // INMEDIATOS y van a las mismas `escritas`/`revocadas` que mira la
    // prueba de atomicidad —a diferencia de `pendientes`, arriba, esto no
    // espera a ningún commit—: es justo la propiedad que distingue una
    // escritura suelta de una transaccional, y la razón por la que ese
    // fallo sí se vería aquí.
    create: jest.fn(async (d: any) => {
      if (opciones.fallaEn === 'crear') throw new Error('fallo al crear la invitación');
      const fila = { id: 11, ...d };
      escritas.push(fila);
      return fila;
    }),
    findLiveByEmail: jest.fn(async () => opciones.invitacionViva ?? null),
    listPendingByClient: jest.fn(async () => []),
    findPendingByIdForClient: jest.fn(async () => opciones.pendiente ?? null),
    revokeLiveByEmail: jest.fn(async (...args: any[]) => {
      revocadas.push(args);
    }),
    markSent: jest.fn(async (...args: any[]) => {
      marcados.push(args);
    }),
  };

  const clientUsers = { findByEmail: jest.fn(async () => opciones.usuarioExistente ?? null) };

  const email = {
    enviados,
    send: jest.fn(async (input: any) => {
      // Se apunta ANTES de fallar, a propósito: las pruebas del camino del
      // fallo necesitan el secreto que se acaba de emitir para comprobar que
      // NO se filtró a la anotación del error, y ese secreto solo existe en
      // el correo que se intentó mandar.
      enviados.push(input);
      if (opciones.envioRechaza || opciones.envioFalla !== undefined) throw opciones.envioFalla;
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

/**
 * Un usuario de cliente que ya tiene esa dirección: **con acceso** y sin ser
 * administrador, que es como nace un alta del panel.
 *
 * Los dos campos son deliberados desde la decisión 12: un usuario
 * DESACTIVADO, no administrador y de la propia empresa ya no rechaza la
 * invitación —se le reinvita, ver el bloque del final—, así que dejar
 * `isActive` sin poner convertiría estas pruebas de rechazo en pruebas de
 * reinvitación sin que se notara.
 */
const usuarioConAcceso = (over: Record<string, unknown> = {}) => ({
  id: '5',
  clientId: '7',
  email: 'nuevo@kuboti.com',
  isActive: 1,
  isAdmin: 0,
  ...over,
});

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
      usuarioExistente: usuarioConAcceso(),
    });
    await expect(service.invite(7, 3, DTO)).rejects.toMatchObject({
      response: { message: INVITE_REJECTED_MESSAGE },
    });
    expect(invitations.runInTransaction).not.toHaveBeenCalled();
  });

  it('un correo que ya es de OTRA empresa se rechaza con exactamente el mismo cuerpo', async () => {
    const propio = makeService({ usuarioExistente: usuarioConAcceso() });
    const ajeno = makeService({
      usuarioExistente: usuarioConAcceso({ id: '8', clientId: '99' }),
    });

    const cuerpoPropio = await propio.service.invite(7, 3, DTO).catch((e) => e.getResponse());
    const cuerpoAjeno = await ajeno.service.invite(7, 3, DTO).catch((e) => e.getResponse());

    expect(cuerpoPropio).toEqual(cuerpoAjeno);
  });

  /**
   * LA PRUEBA QUE PIDE LA SPEC (decisión 7): los tres caminos de rechazo
   * —correo ya es de la propia empresa, ya es de otra, o tiene una
   * invitación viva ajena— tienen que responder EXACTAMENTE lo mismo, código
   * de estado incluido. No basta con comparar el cuerpo: un 403 en vez de un
   * 400 con el mismo texto sigue delatando cuál de los tres ocurrió (aquí,
   * que el correo es de otra empresa), y eso es justo el oráculo que esta
   * funcionalidad existe para negar.
   */
  describe('los tres caminos de rechazo son indistinguibles entre sí', () => {
    const casos: Array<[string, Parameters<typeof makeService>[0]]> = [
      ['ya es un usuario de la propia empresa', { usuarioExistente: usuarioConAcceso() }],
      [
        'ya es un usuario de OTRA empresa',
        { usuarioExistente: usuarioConAcceso({ id: '8', clientId: '99' }) },
      ],
      [
        'tiene una invitación viva en OTRA empresa',
        { invitacionViva: { id: 4, clientId: '99', email: 'nuevo@kuboti.com' } },
      ],
    ];

    it.each(casos)('%s: responde 400 con el texto genérico', async (_nombre, opciones) => {
      const { service } = makeService(opciones);
      const err = await service.invite(7, 3, DTO).catch((e) => e);
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse()).toEqual({
        code: 'INVITACION_RECHAZADA',
        message: INVITE_REJECTED_MESSAGE,
      });
    });

    it('el código de estado y el cuerpo son idénticos entre los tres', async () => {
      const resultados = [];
      for (const [, opciones] of casos) {
        const { service } = makeService(opciones);
        const err = await service.invite(7, 3, DTO).catch((e) => e);
        resultados.push(JSON.stringify({ status: err.getStatus(), body: err.getResponse() }));
      }
      expect(new Set(resultados).size).toBe(1);
    });
  });

  it('un correo con una invitación viva en OTRA empresa se rechaza, y no se le toca la suya', async () => {
    const { service, invitations } = makeService({
      invitacionViva: { id: 4, clientId: '99', email: 'nuevo@kuboti.com' },
    });
    await expect(service.invite(7, 3, DTO)).rejects.toThrow(BadRequestException);
    expect(invitations.runInTransaction).not.toHaveBeenCalled();
  });

  /**
   * «Un mismo correo no acumula invitaciones vivas: invitar de nuevo reemplaza
   * la anterior, que deja de servir.» Dentro de la MISMA empresa, y en este
   * orden: primero se revoca la vieja, después se crea la nueva. Al revés,
   * durante un instante habría dos vivas y la revocación se llevaría por
   * delante la recién creada. Las dos van dentro de la MISMA transacción
   * (finding B): revisar `ordenDeEscritura`, que solo se rellena a través de
   * `manager.getRepository(...)`, es lo que distingue esto de dos escrituras
   * sueltas con el repositorio inyectado.
   */
  it('invitar de nuevo al mismo correo dentro de la empresa revoca la anterior antes de crear la nueva, en una transacción', async () => {
    const { service, invitations } = makeService({
      invitacionViva: { id: 4, clientId: '7', email: 'nuevo@kuboti.com' },
    });
    await service.invite(7, 3, DTO);

    expect(invitations.runInTransaction).toHaveBeenCalledTimes(1);
    expect(invitations.ordenDeEscritura).toEqual(['revocar', 'crear']);
    const [where, patch] = invitations.revocadas[0];
    expect(where).toMatchObject({ email: 'nuevo@kuboti.com', clientId: 7 });
    expect(patch.revokedAt).toBeInstanceOf(Date);
  });

  it.each([[0], [-1], [Number.NaN]])(
    'una sesión con clientId inservible (%s) se rechaza sin escribir nada',
    async (malo) => {
      const { service, invitations } = makeService();
      await expect(service.invite(malo as number, 3, DTO)).rejects.toThrow(UnauthorizedException);
      expect(invitations.runInTransaction).not.toHaveBeenCalled();
    },
  );

  it('una sesión sin clientUserId utilizable tampoco escribe: la invitación quedaría sin autor', async () => {
    const { service, invitations } = makeService();
    await expect(service.invite(7, 0, DTO)).rejects.toThrow(UnauthorizedException);
    expect(invitations.runInTransaction).not.toHaveBeenCalled();
  });
});

describe('la atomicidad de revocar y crear al invitar (finding B)', () => {
  it('revoca y crea con `manager.getRepository(...)`, nunca con el repositorio inyectado', async () => {
    const { service, invitations } = makeService({
      invitacionViva: { id: 4, clientId: '7', email: 'nuevo@kuboti.com' },
    });
    await service.invite(7, 3, DTO);

    expect(invitations.runInTransaction).toHaveBeenCalledTimes(1);
    expect(invitations.create).not.toHaveBeenCalled();
    expect(invitations.revokeLiveByEmail).not.toHaveBeenCalled();
  });

  /**
   * LA PRUEBA DE LA ATOMICIDAD. Sin transacción, un fallo en la creación
   * DESPUÉS de revocar dejaría al invitado sin ningún enlace vivo aunque la
   * petición devolvió error: la revocación ya se habría escrito con el
   * repositorio inyectado, fuera de cualquier posibilidad de deshacerse. Con
   * la transacción, el fallo deshace también la revocación —la invitación
   * anterior sigue viva— porque las dos comparten conexión y o confirman
   * juntas o ninguna se confirma.
   */
  it('si la creación falla después de revocar, la revocación no queda: la anterior sigue viva', async () => {
    const { service, invitations } = makeService({
      invitacionViva: { id: 4, clientId: '7', email: 'nuevo@kuboti.com' },
      fallaEn: 'crear',
    });

    await expect(service.invite(7, 3, DTO)).rejects.toThrow();

    expect(invitations.revocadas).toHaveLength(0);
    expect(invitations.escritas).toHaveLength(0);
  });
});

/**
 * DECISIÓN 12: SE PUEDE REINVITAR A UN USUARIO DESACTIVADO.
 *
 * La spec prometía en «Fuera de alcance» que a quien vuelve «se le invita otra
 * vez», y el código lo impedía: invitar rechazaba cualquier correo ya
 * existente sin mirar si estaba desactivado. El administrador recibía el
 * mensaje genérico y no sabía por qué — justo el trabajo manual que esta
 * funcionalidad existe para eliminar.
 *
 * Se admite exactamente un caso: **desactivado, no administrador y de la
 * propia empresa**. Los otros tres siguen rechazándose, y con el MISMO cuerpo
 * genérico de siempre: si el rechazo del administrador desactivado se
 * distinguiera del de un correo de otra empresa, el portal volvería a ser un
 * comprobador de quién es quién (decisión 7).
 */
describe('reinvitar a un usuario desactivado (decisión 12)', () => {
  const desactivado = usuarioConAcceso({ isActive: 0 });

  it('un desactivado de la propia empresa SÍ se puede reinvitar: se crea y se manda', async () => {
    const { service, invitations, email } = makeService({ usuarioExistente: desactivado });

    const vista = await service.invite(7, 3, DTO);

    expect(invitations.escritas).toHaveLength(1);
    expect(invitations.escritas[0]).toMatchObject({ clientId: 7, email: 'nuevo@kuboti.com' });
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(vista.email).toBe('nuevo@kuboti.com');
  });

  /**
   * Los tres casos que siguen cerrados, y el porqué de cada uno:
   *
   *  - **activo**: ya entra; reinvitarlo sería dejar que un compañero le
   *    reescriba la contraseña.
   *  - **administrador desactivado**: sigue necesitando a la casa, por
   *    coherencia con las decisiones 2 y 9 —si el administrador de cliente no
   *    puede nombrar administradores ni quitarles el acceso, tampoco puede
   *    devolvérselo por la puerta de la invitación—.
   *  - **desactivado de OTRA empresa**: la frontera de siempre. El correo es
   *    único para todo el sistema, así que sin esta condición una empresa
   *    reactivaría —y pondría contraseña a— gente de otra.
   */
  const cerrados: Array<[string, any]> = [
    ['un usuario con acceso', usuarioConAcceso()],
    ['un administrador desactivado', usuarioConAcceso({ isActive: 0, isAdmin: 1 })],
    ['un administrador con acceso', usuarioConAcceso({ isAdmin: 1 })],
    ['un desactivado de OTRA empresa', usuarioConAcceso({ isActive: 0, clientId: '99' })],
  ];

  it.each(cerrados)('%s se sigue rechazando, y sin escribir nada', async (_n, usuario) => {
    const { service, invitations, email } = makeService({ usuarioExistente: usuario });

    await expect(service.invite(7, 3, DTO)).rejects.toThrow(BadRequestException);

    expect(invitations.runInTransaction).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  /**
   * NINGÚN ORÁCULO NUEVO. Los cuatro rechazos —y el de la invitación viva
   * ajena, que ya existía— tienen que seguir dando el mismo par estado+cuerpo.
   * Si «es administrador» respondiera distinto de «es de otra empresa», el
   * administrador que prueba direcciones aprendería el rol y la pertenencia de
   * cada correo que teclee.
   */
  it('los cuatro rechazos son indistinguibles entre sí y del rechazo de siempre', async () => {
    const respuestas: string[] = [];
    for (const [, usuario] of cerrados) {
      const { service } = makeService({ usuarioExistente: usuario });
      const err = await service.invite(7, 3, DTO).catch((e) => e);
      respuestas.push(JSON.stringify({ status: err.getStatus(), body: err.getResponse() }));
    }
    const viva = makeService({
      invitacionViva: { id: 4, clientId: '99', email: 'nuevo@kuboti.com' },
    });
    const errViva = await viva.service.invite(7, 3, DTO).catch((e) => e);
    respuestas.push(JSON.stringify({ status: errViva.getStatus(), body: errViva.getResponse() }));

    expect(respuestas).toHaveLength(5);
    expect(new Set(respuestas).size).toBe(1);
  });

  /**
   * `isActive`/`isAdmin`/`clientId` llegan de la fila cruda: `0`/`1` y el
   * `client_id` como CADENA. Con `===` contra `7`, el dueño legítimo de la
   * reinvitación se comería el rechazo genérico y el defecto volvería a ser
   * invisible.
   */
  it('la empresa se compara con sameId: un clientId en cadena sigue siendo la propia', async () => {
    const { service, invitations } = makeService({
      usuarioExistente: usuarioConAcceso({ isActive: 0, clientId: '7' }),
    });
    await service.invite(7, 3, DTO);
    expect(invitations.escritas).toHaveLength(1);
  });
});

describe('PortalInvitationsService.listPending', () => {
  it('acota por la empresa de la sesión', async () => {
    const { service, invitations } = makeService();
    await service.listPending(7);
    expect(invitations.listPendingByClient).toHaveBeenCalledWith(7, expect.any(Date));
  });

  /**
   * La guarda tiene que comprobarse ANTES de consultar, no solo lanzar en
   * algún momento: si se comprobara después de `listPendingByClient`, esta
   * consulta sin filtro de empresa ya se habría hecho igual. Mismo criterio
   * que `PortalUsersService.list`.
   */
  it.each([[0], [-1], [Number.NaN]])(
    'una sesión con clientId inservible (%s) se rechaza sin consultar',
    async (malo) => {
      const { service, invitations } = makeService();
      await expect(service.listPending(malo as number)).rejects.toThrow(UnauthorizedException);
      expect(invitations.listPendingByClient).not.toHaveBeenCalled();
    },
  );
});

describe('el envío de la invitación', () => {
  it('sale en el acto, a la dirección invitada, con el enlace dentro', async () => {
    const { service, email } = makeService();
    await service.invite(7, 3, DTO);

    expect(email.send).toHaveBeenCalledTimes(1);
    const enviado = email.enviados[0];
    // Normalizado (minúsculas): la fila que crea la transacción pasa por
    // `normalizeEmailAddress`, igual que hacía el repositorio inyectado.
    expect(enviado.to).toBe('nuevo@kuboti.com');
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

    expect(invitations.escritas).toHaveLength(1);
    expect(vista.deliveryFailed).toBe(true);
    // Valor EXACTO, no `toContain`: con la comparación parcial, un motivo
    // que además metiera el enlace completo pasaba en verde.
    expect(invitations.marcados[0][2]).toBe('SMTP dijo que no');
  });

  /**
   * EL CAMINO DEL FALLO, que es el único donde hay algo que escribir sobre el
   * envío. El motivo se compone del error del transporte y se guarda en base;
   * si alguien construyera ahí un texto «más útil» pegándole el `acceptUrl`
   * —o el correo entero— el secreto quedaría en una columna, en un log y en
   * la respuesta HTTP, que es exactamente lo que el resto del módulo trabaja
   * para impedir. La prueba de arriba solo miraba el camino de éxito.
   */
  it('si el correo falla, el secreto no llega ni a la base, ni a la vista, ni al log', async () => {
    const niveles = ['log', 'warn', 'error', 'debug', 'verbose'] as const;
    const espias = niveles.map((nivel) =>
      jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined as never),
    );

    try {
      const { service, invitations, email } = makeService({
        envioFalla: new Error('SMTP dijo que no'),
      });
      const vista = await service.invite(7, 3, DTO);

      const secreto = email.enviados[0].html.match(/\/portal\/invitacion\/([A-Za-z0-9_-]{43})/)[1];
      expect(secreto).toHaveLength(43);

      expect(JSON.stringify(invitations.marcados)).not.toContain(secreto);
      expect(JSON.stringify(invitations.escritas)).not.toContain(secreto);
      expect(JSON.stringify(vista)).not.toContain(secreto);
      expect(JSON.stringify(espias.flatMap((e) => e.mock.calls))).not.toContain(secreto);
      // Y tampoco la dirección completa, que es el secreto con adorno.
      expect(JSON.stringify(invitations.marcados)).not.toContain('/portal/invitacion/');
    } finally {
      espias.forEach((espia) => espia.mockRestore());
    }
  });

  /**
   * El comentario de `deliver` promete que el fallo del envío NO tumba la
   * petición. Si el transporte rechazara con algo que no es un `Error`, leer
   * `.message` de eso reventaría DENTRO del propio catch —donde no hay nada
   * que lo recoja— y la petición saldría con un 500: lo contrario exacto de
   * lo que promete. Hoy nodemailer siempre rechaza con `Error`, pero nada en
   * el código lo fijaba.
   */
  it.each<[string, Parameters<typeof makeService>[0]]>([
    ['una cadena', { envioFalla: 'ECONNREFUSED' }],
    ['un undefined', { envioRechaza: true }],
    ['un null', { envioFalla: null }],
    ['un objeto pelado', { envioFalla: { code: 'EENVELOPE' } }],
  ])('un rechazo que no es un Error (%s) se anota igual, sin tumbar la petición', async (_d, opciones) => {
    const { service, invitations } = makeService(opciones);

    const vista = await service.invite(7, 3, DTO);

    expect(vista.deliveryFailed).toBe(true);
    expect(invitations.escritas).toHaveLength(1);
    expect(typeof invitations.marcados[0][2]).toBe('string');
    expect(invitations.marcados[0][2].length).toBeGreaterThan(0);
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

  /**
   * El comentario de `invite` promete que el secreto «no se registra en
   * ningún log»: esta prueba es la red de esa promesa, no el comentario. Se
   * espía CUALQUIER nivel del `Logger` de Nest —no solo `error`, que es el
   * único que usa hoy el módulo— porque una traza de diagnóstico añadida
   * mañana junto a `generateInvitationSecret()` pasaría igual con una red más
   * estrecha.
   */
  it('el secreto no aparece en ninguna llamada al logger', async () => {
    const niveles = ['log', 'warn', 'error', 'debug', 'verbose'] as const;
    const espias = niveles.map((nivel) =>
      jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined as never),
    );

    try {
      const { service, email } = makeService();
      await service.invite(7, 3, DTO);
      const secreto = email.enviados[0].html.match(/\/portal\/invitacion\/([A-Za-z0-9_-]{43})/)[1];

      const registrado = espias.flatMap((espia) => espia.mock.calls);
      expect(JSON.stringify(registrado)).not.toContain(secreto);
    } finally {
      espias.forEach((espia) => espia.mockRestore());
    }
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
  it('emite un secreto nuevo y deja de servir el anterior, en una transacción', async () => {
    const { service, invitations, email } = makeService({ pendiente });
    await service.resend(7, 11);

    expect(invitations.runInTransaction).toHaveBeenCalledTimes(1);
    const [where] = invitations.revocadas[0];
    expect(where).toMatchObject({ email: 'nuevo@kuboti.com', clientId: 7 });
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

  /**
   * Mismo criterio de atomicidad que al invitar (finding B): reenviar también
   * revoca la anterior y crea la nueva, y las dos tienen que confirmarse
   * juntas o ninguna.
   */
  it('si la creación del secreto nuevo falla, la anterior sigue viva', async () => {
    const { service, invitations } = makeService({ pendiente, fallaEn: 'crear' });
    await expect(service.resend(7, 11)).rejects.toThrow();
    expect(invitations.revocadas).toHaveLength(0);
    expect(invitations.escritas).toHaveLength(0);
  });
});
