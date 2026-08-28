import * as bcrypt from 'bcrypt';
import { IsNull, QueryFailedError } from 'typeorm';

import { INVITATION_INVALID_MESSAGE, PortalInvitationsService } from './portal-invitations.service';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

/**
 * Un `QueryFailedError` tal como lo produce mysql2 al chocar contra
 * `uq_client_users_email`. Mismo doble que usa `client-users.service.spec.ts`:
 * TypeORM copia `code`/`errno` del error del driver sobre la propia
 * excepción, así que con darle un `driverError` de mentira el objeto es
 * indistinguible del real a efectos de `isDuplicateEntryError`.
 */
const duplicadoDeCorreo = () =>
  new QueryFailedError(
    'INSERT INTO client_users ...',
    [],
    Object.assign(new Error("Duplicate entry 'nuevo@kuboti.com' for key 'uq_client_users_email'"), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    }),
  );

/**
 * Un secreto cualquiera de pruebas. No hace falta que salga de
 * `generateInvitationSecret`: lo que se ejerce aquí es que la búsqueda vaya
 * por su huella, y la huella se calcula igual venga de donde venga.
 */
const SECRETO = 'secreto-de-pruebas-de-la-invitacion';

/** Invitación tal como la devuelve TypeORM: los `bigint` salen como CADENA. */
function invitacion(over: Record<string, unknown> = {}) {
  return {
    id: '11',
    clientId: '7',
    email: 'nuevo@kuboti.com',
    fullName: 'Nuevo Nombre',
    secretFingerprint: fingerprintInvitationSecret(SECRETO),
    invitedByClientUserId: '3',
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    usedAt: null,
    acceptedClientUserId: null,
    revokedAt: null,
    lastSentAt: null,
    sendError: null,
    createdAt: new Date('2026-08-26T15:00:00.000Z'),
    ...over,
  } as any;
}

/**
 * Doble del `EntityManager` de una transacción. `runInTransaction` invoca el
 * callback con él y **descarta lo pendiente si el callback lanza**, que es lo
 * que hace un ROLLBACK: por eso las escrituras se acumulan en `pendientes` y
 * solo se vuelcan a `confirmadas` cuando el callback termina bien. Mismo
 * criterio que el doble de `tickets.service.spec.ts`.
 */
function makeService(opciones: {
  fila?: any;
  invitador?: any;
  empresa?: any;
  fallaEn?: 'usuario' | 'marcado';
  filasAfectadasAlMarcar?: number;
  /** Ya hay un usuario de cliente con el correo de la invitación (séptimo motivo). */
  usuarioExistente?: any;
  /** El INSERT del usuario choca contra la clave única: la carrera de ese séptimo motivo. */
  chocaLaClaveUnica?: boolean;
} = {}) {
  const pendientes = { usuarios: [] as any[], marcados: [] as any[] };
  const confirmadas = { usuarios: [] as any[], marcados: [] as any[] };
  /** Toda consulta que llega al repositorio de invitaciones, para inspeccionarla. */
  const consultas: any[] = [];

  const manager = {
    getRepository: (entidad: any) => {
      const nombre = entidad?.name ?? '';
      if (nombre === 'ClientUser') {
        return {
          create: (d: any) => d,
          save: async (d: any) => {
            if (opciones.fallaEn === 'usuario') throw new Error('fallo al guardar el usuario');
            if (opciones.chocaLaClaveUnica) throw duplicadoDeCorreo();
            pendientes.usuarios.push(d);
            return { id: '55', ...d };
          },
        };
      }
      return {
        findOne: async (args: any) => {
          consultas.push(args);
          return opciones.fila ?? null;
        },
        update: async (where: any, patch: any) => {
          if (opciones.fallaEn === 'marcado') throw new Error('fallo al marcar la invitación');
          pendientes.marcados.push([where, patch]);
          return { affected: opciones.filasAfectadasAlMarcar ?? 1 };
        },
      };
    },
  };

  const invitations = {
    runInTransaction: jest.fn(async (work: (m: any) => Promise<unknown>) => {
      const r = await work(manager);
      confirmadas.usuarios.push(...pendientes.usuarios);
      confirmadas.marcados.push(...pendientes.marcados);
      return r;
    }),
    create: jest.fn(),
    findLiveByEmail: jest.fn(async () => null),
    listPendingByClient: jest.fn(async () => []),
    findPendingByIdForClient: jest.fn(async () => null),
    // Por aquí lee `preview`. El mismo doble sirve a las dos rutas a
    // propósito: la prueba tabular de más abajo las compara ENTRE SÍ, y con
    // dos dobles distintos una diferencia podría venir del doble y no del
    // código.
    findByFingerprint: jest.fn(async () => opciones.fila ?? null),
    revokeLiveByEmail: jest.fn(async () => undefined),
    markSent: jest.fn(async () => undefined),
  };

  const clientUsers = {
    findByEmail: jest.fn(async () => opciones.usuarioExistente ?? null),
    findById: jest.fn(async () => opciones.invitador ?? { id: '3', isActive: 1 }),
  };
  const email = { send: jest.fn(async () => ({ messageId: 'x', accepted: [], rejected: [] })) };
  const clients = {
    findByIdOrFail: jest.fn(async () => opciones.empresa ?? { id: 7, razonSocial: 'Acme', status: 'CLIENT' }),
  };
  const config = { get: (k: string, f?: string) => f };

  const service = new PortalInvitationsService(
    invitations as any, clientUsers as any, email as any, clients as any, config as any,
  );
  return { service, invitations, clientUsers, confirmadas, consultas };
}

const BUENO = { secret: SECRETO, password: 'contrasena-larga', passwordConfirmation: 'contrasena-larga' };

describe('aceptar una invitación', () => {
  it('crea el usuario con el nombre, el correo y la empresa DE LA INVITACIÓN', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);

    expect(confirmadas.usuarios[0]).toMatchObject({
      clientId: 7,
      email: 'nuevo@kuboti.com',
      fullName: 'Nuevo Nombre',
    });
  });

  /**
   * La empresa sale de la invitación, jamás de nada que ponga quien acepta.
   * Con la petición manipulada, no confiando en el tipo.
   */
  it('ignora una empresa colada en el cuerpo de quien acepta', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept({ ...BUENO, clientId: 99 } as any);
    expect(confirmadas.usuarios[0].clientId).toBe(7);
  });

  /**
   * Decisión 2 de la spec: no se puede crear un administrador desde el portal
   * ni aunque la petición lo pida explícitamente.
   */
  it('el usuario nace SIN ser administrador aunque el cuerpo lo pida', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept({ ...BUENO, isAdmin: true } as any);
    expect(confirmadas.usuarios[0].isAdmin).toBe(0);
  });

  it('la autoría queda honesta: sin personal inventado y con el administrador que invitó', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);
    expect(confirmadas.usuarios[0].createdBy).toBeNull();
    expect(confirmadas.usuarios[0].createdByClientUserId).toBe(3);
  });

  it('la contraseña se guarda cifrada, nunca en claro', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);
    const hash = confirmadas.usuarios[0].passwordHash;
    expect(hash).not.toBe(BUENO.password);
    expect(await bcrypt.compare(BUENO.password, hash)).toBe(true);
  });

  /**
   * La búsqueda va por huella. Si alguna consulta llevara el secreto en claro
   * significaría que existe una columna que lo guarda —o que alguien piensa
   * que existe—, y esta funcionalidad entera se apoya en que no.
   */
  it('busca por huella, y el secreto en claro no aparece en ninguna consulta', async () => {
    const { service, consultas, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);

    expect(consultas[0].where.secretFingerprint).toBe(fingerprintInvitationSecret(SECRETO));
    expect(JSON.stringify(consultas)).not.toContain(SECRETO);
    expect(JSON.stringify(confirmadas)).not.toContain(SECRETO);
  });

  it('marca la invitación como usada y anota quién la aceptó', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);
    const [, patch] = confirmadas.marcados[0];
    expect(patch.usedAt).toBeInstanceOf(Date);
    expect(patch.acceptedClientUserId).toBe(55);
  });

  it('devuelve el correo con el que entrar, y ningún token de sesión', async () => {
    const { service } = makeService({ fila: invitacion() });
    const r = await service.accept(BUENO);
    expect(r).toEqual({ email: 'nuevo@kuboti.com' });
  });
});

describe('la transacción de aceptar es todo o nada', () => {
  it.each([
    ['al crear el usuario', 'usuario'],
    ['al marcar la invitación como usada', 'marcado'],
  ] as const)('si falla %s no queda ni usuario ni invitación gastada', async (_d, punto) => {
    const { service, confirmadas } = makeService({ fila: invitacion(), fallaEn: punto });

    await expect(service.accept(BUENO)).rejects.toThrow();

    expect(confirmadas.usuarios).toHaveLength(0);
    expect(confirmadas.marcados).toHaveLength(0);
  });

  /**
   * La carrera de dos aceptaciones simultáneas. El `UPDATE` va condicionado a
   * que la invitación siga sin usar; si no afectó a ninguna fila es que otra
   * petición se adelantó, y hay que reventar la transacción para que el
   * usuario que esta acababa de crear no sobreviva.
   */
  it('si el marcado no afecta a ninguna fila, el usuario tampoco queda', async () => {
    const { service, confirmadas } = makeService({
      fila: invitacion(),
      filasAfectadasAlMarcar: 0,
    });

    await expect(service.accept(BUENO)).rejects.toMatchObject({
      response: { message: INVITATION_INVALID_MESSAGE },
    });
    expect(confirmadas.usuarios).toHaveLength(0);
  });
});

/**
 * LA PRUEBA QUE PIDE LA SPEC, con dientes en las dos direcciones.
 *
 * No basta con que los siete motivos fallen, ni con comparar solo el cuerpo:
 *
 *  1. Se compara la PAREJA COMPLETA —código de estado y cuerpo—. Un fallo que
 *     devolviera 403 con el cuerpo idéntico en uno solo de los siete pasaba en
 *     verde mirando solo el cuerpo, y sigue siendo un oráculo perfecto. Peor
 *     todavía: `HttpExceptionFilter` mete `statusCode` DENTRO del cuerpo que
 *     sale por el cable, así que en producción dos motivos con estados
 *     distintos tampoco tendrían el cuerpo idéntico — la uniformidad se rompe
 *     sola en cuanto el estado se mueve.
 *  2. Se comparan las DOS RUTAS entre sí, no cada una por su lado. Si la vista
 *     previa distinguiera un caso que aceptar no distingue —o al revés—, la
 *     diferencia entre las dos respuestas delataría ese motivo igual de bien
 *     que un texto distinto: bastaría con pedir las dos y ver cuál discrepa.
 *
 * Las dos rutas comparten aquí el mismo doble a propósito: con dos dobles
 * distintos, una diferencia podría venir del doble y no del código.
 */
describe('los siete motivos de invalidez responden lo mismo, en las dos rutas', () => {
  const casos: Array<[string, Parameters<typeof makeService>[0]]> = [
    ['no existe', { fila: null }],
    ['caducada', { fila: invitacion({ expiresAt: new Date(Date.now() - 1000) }) }],
    ['ya usada', { fila: invitacion({ usedAt: new Date() }) }],
    ['revocada por otra posterior', { fila: invitacion({ revokedAt: new Date() }) }],
    ['quien invitó está desactivado', { fila: invitacion(), invitador: { id: '3', isActive: 0 } }],
    [
      'la empresa ya no es cliente',
      { fila: invitacion(), empresa: { id: 7, razonSocial: 'Acme', status: 'FORMER_CLIENT' } },
    ],
    // El SÉPTIMO: el personal dio de alta esa dirección desde el panel
    // mientras la invitación seguía viva, y el alta del panel NO revoca
    // invitaciones. Antes salía por aquí un 500 —distinguible del 400
    // uniforme— y la invitación quedaba inaceptable para siempre, porque el
    // choque contra la clave única se repite en cada intento.
    [
      'la dirección ya es de un usuario',
      {
        fila: invitacion(),
        usuarioExistente: { id: '5', clientId: '7', email: 'nuevo@kuboti.com' },
      },
    ],
  ];

  const rutas = {
    aceptar: (s: PortalInvitationsService) => s.accept(BUENO),
    'vista previa': (s: PortalInvitationsService) => s.preview(SECRETO),
  };

  type Ruta = keyof typeof rutas;
  type Opciones = Parameters<typeof makeService>[0];

  const cruce: Array<[Ruta, string, Opciones]> = (Object.keys(rutas) as Ruta[]).flatMap((ruta) =>
    casos.map(([nombre, opciones]): [Ruta, string, Opciones] => [ruta, nombre, opciones]),
  );

  /** La pareja completa, serializada: nunca solo el cuerpo. */
  async function respuesta(ruta: Ruta, opciones: Opciones): Promise<string> {
    const { service } = makeService(opciones);
    return rutas[ruta](service).then(
      () => 'NO FALLÓ',
      (e) => JSON.stringify({ status: e.getStatus(), body: e.getResponse() }),
    );
  }

  it.each(cruce)('%s — %s: responde 400 con el cuerpo único', async (ruta, _nombre, opciones) => {
    const { service } = makeService(opciones);
    const err = await rutas[ruta](service).catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toEqual({
      code: 'INVITACION_NO_VALIDA',
      message: INVITATION_INVALID_MESSAGE,
    });
  });

  it('las catorce respuestas —estado Y cuerpo— son idénticas entre sí', async () => {
    const respuestas: string[] = [];
    for (const [ruta, , opciones] of cruce) {
      respuestas.push(await respuesta(ruta, opciones));
    }
    expect(respuestas).toHaveLength(14);
    expect(new Set(respuestas).size).toBe(1);
  });

  it.each(casos)('%s: aceptar y la vista previa responden exactamente igual', async (_n, opciones) => {
    expect(await respuesta('vista previa', opciones)).toBe(await respuesta('aceptar', opciones));
  });

  it('y ninguno de ellos deja usuario creado', async () => {
    for (const [, opciones] of casos) {
      const { service, confirmadas } = makeService(opciones);
      await service.accept(BUENO).catch(() => undefined);
      expect(confirmadas.usuarios).toHaveLength(0);
    }
  });

  /**
   * Decisión 1 de la spec: un prospecto NO es una empresa desactivada. Esta
   * prueba existía para la vista previa y NO para aceptar, y esa asimetría
   * dejaba vivo un mutante concreto: endurecer la comprobación a
   * `status !== 'CLIENT'` SOLO en aceptar. La vista previa saludaría al
   * prospecto y aceptar le diría «enlace no válido» — justo la divergencia
   * entre las dos rutas que este bloque existe para impedir.
   */
  it('un prospecto sí puede aceptar, igual que ve su vista previa', async () => {
    const opciones = {
      fila: invitacion(),
      empresa: { id: 7, razonSocial: 'Acme', status: 'PROSPECT' },
    };

    await expect(makeService(opciones).service.accept(BUENO)).resolves.toEqual({
      email: 'nuevo@kuboti.com',
    });
    await expect(makeService(opciones).service.preview(SECRETO)).resolves.toEqual({
      fullName: 'Nuevo Nombre',
      clientName: 'Acme',
    });
  });

  /**
   * La carrera del séptimo motivo. La comprobación previa cubre el caso
   * normal, pero dos altas de la misma dirección —una por el panel, otra por
   * aquí— pueden pasar las dos por la lectura antes de que cualquiera
   * escriba. El choque contra `uq_client_users_email` tiene que salir con el
   * MISMO cuerpo uniforme, no como el 500 que salía antes.
   */
  it('la carrera contra la clave única sale con el mismo cuerpo, y sin dejar nada escrito', async () => {
    const opciones: Opciones = { fila: invitacion(), chocaLaClaveUnica: true };
    const { service, confirmadas } = makeService(opciones);

    const err = await service.accept(BUENO).catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toEqual({
      code: 'INVITACION_NO_VALIDA',
      message: INVITATION_INVALID_MESSAGE,
    });
    expect(confirmadas.usuarios).toHaveLength(0);
    expect(confirmadas.marcados).toHaveLength(0);
    // Y es el MISMO par estado+cuerpo que los otros siete motivos.
    expect(await respuesta('aceptar', opciones)).toBe(await respuesta('aceptar', casos[0][1]));
  });

  /**
   * Solo el choque de clave duplicada degrada al cuerpo uniforme. Cualquier
   * otro fallo de escritura —la base caída, una columna que no encaja— tiene
   * que seguir subiendo como el 500 que de verdad es: disfrazarlo de
   * «invitación mala» perdería el fallo real. Mismo criterio que
   * `ClientUsersService.create`.
   */
  it('un fallo de escritura que NO es la clave duplicada sigue subiendo tal cual', async () => {
    const { service } = makeService({ fila: invitacion(), fallaEn: 'usuario' });
    await expect(service.accept(BUENO)).rejects.toThrow('fallo al guardar el usuario');
  });
});

/**
 * Las DOS mitades del uso único. El código real ya cierra la carrera de dos
 * aceptaciones simultáneas del mismo enlace, pero ninguna prueba lo sostenía:
 * quitar el bloqueo de la lectura, o quitar el `usedAt: IsNull()` del WHERE
 * del UPDATE, dejaba la suite entera en verde. Las dos son invisibles con un
 * doble en memoria si no se mira la FORMA de la consulta, porque un doble no
 * tiene concurrencia real que romper.
 */
describe('el uso único descansa en dos mitades, y las dos están fijadas', () => {
  it('primera mitad: la invitación se lee con bloqueo de escritura', async () => {
    const { service, consultas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);

    // Sin `pessimistic_write`, dos aceptaciones simultáneas leen las dos la
    // misma fila sin usar y las dos siguen adelante.
    expect(consultas[0].lock).toEqual({ mode: 'pessimistic_write' });
  });

  it('segunda mitad: el marcado va condicionado a que la invitación siga sin usar', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);

    const [where] = confirmadas.marcados[0];
    // `usedAt: IsNull()` en el WHERE, no solo el `id`: sin esa condición el
    // UPDATE afectaría a la fila aunque otra petición ya la hubiera
    // consumido, `affected` valdría 1, y la comprobación del `affected !== 1`
    // —que sí tiene prueba— no llegaría a dispararse nunca.
    expect(where).toEqual({ id: '11', usedAt: IsNull() });
  });
});

/**
 * El coste de cifrado no lo fijaba ninguna prueba: bajarlo sobrevivía. Y el
 * comentario de `BCRYPT_ROUNDS` dice justo por qué importa — el hash señuelo
 * de `PortalAuthService` se calculó a coste 10, y un alta con otro coste
 * reabre el canal de tiempos que ese señuelo existe para cerrar.
 */
describe('el coste de cifrado de la contraseña', () => {
  it('es 10, el mismo que el resto del portal', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);

    const hash: string = confirmadas.usuarios[0].passwordHash;
    // `$2b$10$...`: el segundo campo del hash es el coste, en claro.
    expect(hash.split('$')[2]).toBe('10');
  });
});

describe('la contraseña', () => {
  /**
   * La confirmación se comprueba ANTES de mirar el enlace. Al revés, mandar
   * dos contraseñas distintas serviría de oráculo: un error de validación
   * significaría "el enlace es bueno" y el cuerpo genérico, "no lo es".
   */
  it('si las dos no coinciden falla por eso, sin llegar a mirar el enlace', async () => {
    const { service, invitations } = makeService({ fila: null });
    await expect(
      service.accept({ ...BUENO, passwordConfirmation: 'otra-cosa-distinta' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(invitations.runInTransaction).not.toHaveBeenCalled();
  });

  it('el mensaje de la confirmación va en español y no menciona el enlace', async () => {
    const { service } = makeService({ fila: invitacion() });
    const cuerpo = await service
      .accept({ ...BUENO, passwordConfirmation: 'otra-cosa-distinta' })
      .catch((e) => e.getResponse());
    expect(cuerpo.message).toMatch(/no coinciden/i);
    expect(cuerpo.message).not.toMatch(/enlace|invitaci/i);
  });
});
