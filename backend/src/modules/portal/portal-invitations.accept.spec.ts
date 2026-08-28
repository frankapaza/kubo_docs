import * as bcrypt from 'bcrypt';

import { INVITATION_INVALID_MESSAGE, PortalInvitationsService } from './portal-invitations.service';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

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
    revokeLiveByEmail: jest.fn(async () => undefined),
    markSent: jest.fn(async () => undefined),
  };

  const clientUsers = {
    findByEmail: jest.fn(async () => null),
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

describe('todos los fallos al aceptar responden exactamente lo mismo', () => {
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
  ];

  it.each(casos)('%s falla', async (_nombre, opciones) => {
    const { service } = makeService(opciones);
    await expect(service.accept(BUENO)).rejects.toMatchObject({
      response: { code: 'INVITACION_NO_VALIDA', message: INVITATION_INVALID_MESSAGE },
    });
  });

  /**
   * LA PRUEBA QUE PIDE LA SPEC: no basta con que los seis fallen; los CUERPOS
   * tienen que ser idénticos entre sí, byte a byte. La diferencia entre «no
   * existe», «caducada» y «ya usada» solo le sirve a quien está probando.
   */
  it('los cuerpos de respuesta son idénticos entre sí', async () => {
    const cuerpos = [];
    for (const [, opciones] of casos) {
      const { service } = makeService(opciones);
      cuerpos.push(await service.accept(BUENO).catch((e) => JSON.stringify(e.getResponse())));
    }
    expect(new Set(cuerpos).size).toBe(1);
  });

  it('y ninguno de ellos deja usuario creado', async () => {
    for (const [, opciones] of casos) {
      const { service, confirmadas } = makeService(opciones);
      await service.accept(BUENO).catch(() => undefined);
      expect(confirmadas.usuarios).toHaveLength(0);
    }
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
