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
 * `generateInvitationSecret` —lo que se ejerce aquí es que la búsqueda vaya
 * por su huella, y la huella se calcula igual venga de donde venga— pero sí
 * que tenga la FORMA de uno: 43 caracteres del alfabeto `base64url`, que es
 * lo que `isWellFormedInvitationSecret` exige ahora en las dos rutas.
 */
const SECRETO = 'secreto-de-pruebas-de-la-invitacionxxxxxxxx';

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
  const pendientes = { usuarios: [] as any[], marcados: [] as any[], reactivados: [] as any[] };
  const confirmadas = { usuarios: [] as any[], marcados: [] as any[], reactivados: [] as any[] };
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
          // Por aquí pasa la reactivación de la decisión 12. Se acumula en
          // `pendientes` igual que el alta: si el callback lanza después, no
          // se vuelca nada — es lo que comprueba que la reactivación también
          // vive DENTRO de la transacción y no sobrevive a un ROLLBACK.
          update: async (id: any, patch: any) => {
            if (opciones.fallaEn === 'usuario') throw new Error('fallo al reactivar el usuario');
            pendientes.reactivados.push([id, patch]);
            return { affected: 1 };
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
      confirmadas.reactivados.push(...pendientes.reactivados);
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
      // ACTIVO, que es como nace un alta del panel: un usuario DESACTIVADO de
      // esta misma empresa y sin ser administrador ya no invalida el enlace,
      // lo reactiva (decisión 12; ver el bloque de la reinvitación más abajo).
      'la dirección ya es de un usuario con acceso',
      {
        fila: invitacion(),
        usuarioExistente: {
          id: '5',
          clientId: '7',
          email: 'nuevo@kuboti.com',
          isActive: 1,
          isAdmin: 0,
        },
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

/**
 * DECISION 12: ACEPTAR REACTIVA A QUIEN VUELVE, NO CREA OTRA FILA.
 *
 * La spec prometia en «Fuera de alcance» que a quien vuelve «se le invita otra
 * vez» y el codigo lo impedia en los dos extremos: invitar rechazaba el correo
 * existente, y aceptar lo repetia. Ahora un usuario DESACTIVADO, no
 * administrador y de la empresa de la invitacion se reactiva con su nueva
 * contrasena y su nombre nuevo.
 *
 * Crear una segunda fila no era alternativa: `uq_client_users_email` hace el
 * correo unico para todo el sistema, y ademas partiria en dos la historia de
 * esa persona --sus tickets y sus mensajes cuelgan de la fila que ya existe--,
 * que es justo lo que la decision 4 («desactivar, no borrar») conserva.
 */
describe('aceptar reactiva a un usuario desactivado (decision 12)', () => {
  /** El desactivado que SI admite reinvitacion: no administrador y de la 7. */
  const vuelve = {
    id: '5',
    clientId: '7',
    email: 'nuevo@kuboti.com',
    fullName: 'Nombre De Antes',
    isActive: 0,
    isAdmin: 0,
  };

  it('actualiza la fila que ya existe y NO crea ninguna nueva', async () => {
    const { service, confirmadas } = makeService({
      fila: invitacion(),
      usuarioExistente: vuelve,
    });

    await service.accept(BUENO);

    expect(confirmadas.usuarios).toHaveLength(0);
    expect(confirmadas.reactivados).toHaveLength(1);
    const [id] = confirmadas.reactivados[0];
    expect(id).toBe(5);
  });

  it('le devuelve el acceso con la contrasena nueva y el nombre de esta invitacion', async () => {
    const { service, confirmadas } = makeService({
      fila: invitacion(),
      usuarioExistente: vuelve,
    });

    await service.accept(BUENO);

    const [, patch] = confirmadas.reactivados[0];
    expect(patch.isActive).toBe(1);
    // El nombre, el de la invitacion de ahora --no el de la fila vieja--: la
    // persona puede volver con otro apellido, o el de entonces estar mal
    // escrito.
    expect(patch.fullName).toBe('Nuevo Nombre');
    expect(patch.passwordHash).not.toBe(BUENO.password);
    expect(await bcrypt.compare(BUENO.password, patch.passwordHash)).toBe(true);
    // Mismo coste que el alta: otro coste en esta rama seria una segunda regla
    // para la misma contrasena, y ademas medible desde fuera.
    expect(patch.passwordHash.split('$')[2]).toBe('10');
  });

  /**
   * Lo que la reactivacion NO puede tocar. `isAdmin`, porque desde el portal
   * no se nombran administradores (decision 2) y este seria el sitio por donde
   * colarlo; la autoria, porque quien creo a esa persona es un hecho pasado y
   * reactivar no es crear (decision 8).
   */
  it('no reescribe el rol ni la autoria: solo acceso, contrasena y nombre', async () => {
    const { service, confirmadas } = makeService({
      fila: invitacion(),
      usuarioExistente: vuelve,
    });

    await service.accept(BUENO);

    const [, patch] = confirmadas.reactivados[0];
    expect(Object.keys(patch).sort()).toEqual(['fullName', 'isActive', 'passwordHash']);
  });

  it('la invitacion queda consumida y anota a la persona que ya existia', async () => {
    const { service, confirmadas } = makeService({
      fila: invitacion(),
      usuarioExistente: vuelve,
    });

    await service.accept(BUENO);

    const [, patch] = confirmadas.marcados[0];
    expect(patch.usedAt).toBeInstanceOf(Date);
    // El id de la fila reactivada, no un 55 recien creado.
    expect(patch.acceptedClientUserId).toBe(5);
  });

  /**
   * La reactivacion vive DENTRO de la transaccion. Escrita con el repositorio
   * inyectado, un fallo posterior dejaria a la persona con la contrasena nueva
   * y la invitacion sin consumir --o al reves--, que es exactamente lo que
   * «una sola transaccion» promete que no pasa.
   */
  it('si el marcado no afecta a ninguna fila, la reactivacion tampoco queda', async () => {
    const { service, confirmadas } = makeService({
      fila: invitacion(),
      usuarioExistente: vuelve,
      filasAfectadasAlMarcar: 0,
    });

    await expect(service.accept(BUENO)).rejects.toMatchObject({
      response: { message: INVITATION_INVALID_MESSAGE },
    });
    expect(confirmadas.reactivados).toHaveLength(0);
  });

  /**
   * NO SE DISTINGUE POR EL CUERPO. Reactivar y crear devuelven exactamente la
   * misma respuesta: si la reactivacion se notara desde fuera, quien tiene un
   * enlace sabria que esa direccion ya existia desactivada.
   */
  it('responde exactamente lo mismo que un alta nueva', async () => {
    const nueva = await makeService({ fila: invitacion() }).service.accept(BUENO);
    const reactivada = await makeService({
      fila: invitacion(),
      usuarioExistente: vuelve,
    }).service.accept(BUENO);

    expect(reactivada).toEqual(nueva);
  });

  /**
   * Y LA VISTA PREVIA SALUDA IGUAL. Si `preview` rechazara este caso y
   * `accept` lo admitiera, la diferencia entre las dos respuestas delataria
   * que esa direccion pertenece a un usuario desactivado de esa empresa: el
   * mismo oraculo que el cuerpo unico existe para negar.
   */
  it('la vista previa saluda a quien vuelve, igual que aceptar le deja pasar', async () => {
    const { service } = makeService({ fila: invitacion(), usuarioExistente: vuelve });
    await expect(service.preview(SECRETO)).resolves.toEqual({
      fullName: 'Nuevo Nombre',
      clientName: 'Acme',
    });
  });

  /**
   * Los casos que NO admiten reinvitacion siguen siendo el septimo motivo de
   * invalidez, con el cuerpo unico y EN LAS DOS RUTAS. Un administrador
   * desactivado sigue necesitando a la casa (decisiones 2 y 9), y un
   * desactivado de otra empresa es la frontera de siempre.
   */
  const cerrados: Array<[string, any]> = [
    ['con acceso', { ...vuelve, isActive: 1 }],
    ['administrador desactivado', { ...vuelve, isAdmin: 1 }],
    ['administrador con acceso', { ...vuelve, isActive: 1, isAdmin: 1 }],
    ['desactivado de OTRA empresa', { ...vuelve, clientId: '99' }],
  ];

  it.each(cerrados)('un usuario %s invalida el enlace en las dos rutas', async (_n, usuario) => {
    const opciones = { fila: invitacion(), usuarioExistente: usuario };

    for (const ruta of [
      (s: PortalInvitationsService) => s.accept(BUENO),
      (s: PortalInvitationsService) => s.preview(SECRETO),
    ]) {
      const { service } = makeService(opciones);
      const err = await ruta(service).catch((e) => e);
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse()).toEqual({
        code: 'INVITACION_NO_VALIDA',
        message: INVITATION_INVALID_MESSAGE,
      });
    }
  });

  it('y ninguno de esos casos deja nada escrito', async () => {
    for (const [, usuario] of cerrados) {
      const { service, confirmadas } = makeService({
        fila: invitacion(),
        usuarioExistente: usuario,
      });
      await service.accept(BUENO).catch(() => undefined);
      expect(confirmadas.usuarios).toHaveLength(0);
      expect(confirmadas.reactivados).toHaveLength(0);
      expect(confirmadas.marcados).toHaveLength(0);
    }
  });

  /**
   * La empresa se compara con `sameId`: TypeORM devuelve `client_id` como
   * CADENA. Con `===` contra el numero, la reinvitacion legitima caeria en el
   * cuerpo generico y el defecto volveria a ser invisible.
   */
  it('la empresa se compara sin exigir el mismo tipo', async () => {
    const { service, confirmadas } = makeService({
      fila: invitacion({ clientId: 7 }),
      usuarioExistente: { ...vuelve, clientId: '7' },
    });
    await service.accept(BUENO);
    expect(confirmadas.reactivados).toHaveLength(1);
  });
});

/**
 * LA FORMA DEL SECRETO, LA MISMA EN LAS DOS RUTAS.
 *
 * Aceptar la validaba y la vista previa no miraba nada --le llega por la ruta,
 * donde no hay `ValidationPipe`--: dos disciplinas para el mismo valor. Ahora
 * las dos usan `isWellFormedInvitationSecret`, y las dos responden el cuerpo
 * generico de siempre: una forma mala que respondiera distinto seria un
 * oraculo mas, no una proteccion.
 */
describe('la forma del secreto se comprueba igual al aceptar y en la vista previa', () => {
  const malos: Array<[string, string]> = [
    ['vacio', ''],
    ['demasiado corto', 'x'.repeat(42)],
    ['demasiado largo', 'x'.repeat(44)],
    ['con relleno de base64', `${'x'.repeat(42)}=`],
    ['con un caracter fuera del alfabeto', `${'x'.repeat(42)}+`],
    ['con una barra', `${'x'.repeat(42)}/`],
    ['con un espacio', `${'x'.repeat(42)} `],
  ];

  it.each(malos)('%s: las dos rutas dan el mismo cuerpo unico', async (_n, secreto) => {
    for (const ruta of [
      (s: PortalInvitationsService) => s.accept({ ...BUENO, secret: secreto }),
      (s: PortalInvitationsService) => s.preview(secreto),
    ]) {
      const { service } = makeService({ fila: invitacion() });
      const err = await ruta(service).catch((e) => e);
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse()).toEqual({
        code: 'INVITACION_NO_VALIDA',
        message: INVITATION_INVALID_MESSAGE,
      });
    }
  });

  it('una forma imposible no llega siquiera a consultar la base', async () => {
    const { service, invitations } = makeService({ fila: invitacion() });
    await service.accept({ ...BUENO, secret: 'no-tiene-forma' }).catch(() => undefined);
    await service.preview('no-tiene-forma').catch(() => undefined);
    expect(invitations.runInTransaction).not.toHaveBeenCalled();
    expect(invitations.findByFingerprint).not.toHaveBeenCalled();
  });

  /**
   * La confirmacion de contrasena se sigue mirando ANTES que la forma del
   * enlace. Al reves, dos contrasenas distintas con un enlace mal formado
   * darian el cuerpo generico y con uno bien formado el error de validacion:
   * ese par volveria a ser el oraculo que el orden actual cierra.
   */
  it('la confirmacion de contrasena se sigue mirando antes que la forma del enlace', async () => {
    const { service } = makeService({ fila: invitacion() });
    await expect(
      service.accept({
        secret: 'no-tiene-forma',
        password: 'a'.repeat(9),
        passwordConfirmation: 'b'.repeat(9),
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });
});
