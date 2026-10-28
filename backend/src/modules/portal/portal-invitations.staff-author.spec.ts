import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PortalInvitationsService, INVITATION_INVALID_MESSAGE } from './portal-invitations.service';
import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { ClientUser } from './entities/client-user.entity';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

/**
 * Doble de repositorio de TypeORM sobre un array. Solo lo que usan `accept` y
 * `replaceInvitation`; nada genérico, para que se vea qué se está fingiendo.
 */
function repoSobre<T extends { id?: number }>(filas: T[]) {
  return {
    filas,
    create: (data: Partial<T>) => ({ ...data }) as T,
    save: async (fila: T) => {
      const guardada = { ...fila, id: fila.id ?? filas.length + 1 } as T;
      filas.push(guardada);
      return guardada;
    },
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      filas.find((f) =>
        Object.entries(where).every(
          ([k, v]) => typeof v !== 'object' && (f as Record<string, unknown>)[k] === v,
        ),
      ) ?? null,
    update: async (criterio: unknown, patch: Partial<T>) => {
      const id = typeof criterio === 'object' ? (criterio as { id?: number }).id : (criterio as number);
      const fila = filas.find((f) => f.id === id);
      if (!fila) return { affected: 0 };
      Object.assign(fila, patch);
      return { affected: 1 };
    },
  };
}

interface Mundo {
  invitaciones: ClientUserInvitation[];
  usuariosDeCliente: ClientUser[];
  personal: { id: number; isActive: number }[];
  correosEnviados: { to: string }[];
}

function crearServicio(mundo: Mundo) {
  const invRepo = repoSobre(mundo.invitaciones as unknown as { id?: number }[]);
  const userRepo = repoSobre(mundo.usuariosDeCliente as unknown as { id?: number }[]);

  const invitations = {
    runInTransaction: async (work: (m: unknown) => Promise<unknown>) =>
      work({
        getRepository: (entidad: unknown) => (entidad === ClientUserInvitation ? invRepo : userRepo),
      }),
    findLiveByEmail: async () => null,
    findByFingerprint: async (huella: string) =>
      mundo.invitaciones.find((i) => i.secretFingerprint === huella) ?? null,
    // Busca de verdad, con el filtro de empresa y de estado que hace la
    // consulta real: sin esto, reenviar no se podía probar.
    findPendingByIdForClient: async (id: number, clientId: number) =>
      mundo.invitaciones.find(
        (i) =>
          Number(i.id) === Number(id) &&
          Number(i.clientId) === Number(clientId) &&
          !i.usedAt &&
          !i.revokedAt,
      ) ?? null,
    markSent: async () => undefined,
  };

  const clientUsers = {
    findByEmail: async (email: string) =>
      mundo.usuariosDeCliente.find((u) => u.email === email) ?? null,
    findById: async (id: number) => mundo.usuariosDeCliente.find((u) => Number(u.id) === id) ?? null,
  };

  const email = { send: async (m: { to: string }) => void mundo.correosEnviados.push(m) };
  const clients = { findByIdOrFail: async (id: number) => ({ id, razonSocial: 'ACME', status: 'CLIENT' }) };
  const users = { findById: async (id: number) => mundo.personal.find((u) => u.id === id) ?? null };
  const config = new ConfigService({ FRONTEND_URL: 'https://portal.example' });

  return new PortalInvitationsService(
    invitations as never,
    clientUsers as never,
    email as never,
    clients as never,
    config,
    users as never,
  );
}

const DTO = { email: 'ana@x.com', fullName: 'Ana Pérez' };

function mundoVacio(): Mundo {
  return { invitaciones: [], usuariosDeCliente: [], personal: [{ id: 40, isActive: 1 }], correosEnviados: [] };
}

/**
 * Una invitación YA GUARDADA, como la devolvería la base: viva, de la empresa
 * 7 y con el autor que se le diga. Lo que no se diga queda a `null`, incluidas
 * **las dos columnas de autor**, para que escribir una fila sin autor cueste
 * lo mismo que escribirla con él.
 */
function filaGuardada(
  parcial: Partial<ClientUserInvitation>,
  secret = 'A'.repeat(43),
): ClientUserInvitation {
  return {
    id: 1,
    clientId: 7,
    email: 'ana@x.com',
    fullName: 'Ana Pérez',
    secretFingerprint: fingerprintInvitationSecret(secret),
    invitedByClientUserId: null,
    invitedByUserId: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    usedAt: null,
    acceptedClientUserId: null,
    revokedAt: null,
    lastSentAt: null,
    sendError: null,
    createdAt: new Date(),
    ...parcial,
  } as ClientUserInvitation;
}

describe('invitar desde el panel — el autor es del personal, y se dice cuál', () => {
  it('escribe invited_by_user_id y deja vacío el del portal: exactamente uno de los dos', async () => {
    const mundo = mundoVacio();
    const service = crearServicio(mundo);

    await service.invite(7, { kind: 'STAFF', userId: 40 }, DTO);

    expect(mundo.invitaciones).toHaveLength(1);
    expect(Number(mundo.invitaciones[0].invitedByUserId)).toBe(40);
    expect(mundo.invitaciones[0].invitedByClientUserId).toBeNull();
  });

  it('invitar desde el portal sigue escribiendo el del portal y no el del personal', async () => {
    const mundo = mundoVacio();
    const service = crearServicio(mundo);

    await service.invite(7, { kind: 'CLIENT_ADMIN', clientUserId: 3 }, DTO);

    expect(Number(mundo.invitaciones[0].invitedByClientUserId)).toBe(3);
    expect(mundo.invitaciones[0].invitedByUserId).toBeNull();
  });
});

describe('aceptar una invitación de la casa', () => {
  /** Deja en el mundo una invitación viva creada por el personal y devuelve su secreto. */
  async function invitacionDeLaCasa(mundo: Mundo): Promise<string> {
    const service = crearServicio(mundo);
    const { secret } = await service.inviteWithSecret(7, { kind: 'STAFF', userId: 40 }, DTO);
    return secret;
  }

  it('el usuario nace con created_by del personal y sin autor de cliente — decisión 8 de R4', async () => {
    const mundo = mundoVacio();
    const secret = await invitacionDeLaCasa(mundo);

    await crearServicio(mundo).accept({
      secret,
      password: 'unaClaveLarga1',
      passwordConfirmation: 'unaClaveLarga1',
    });

    expect(mundo.usuariosDeCliente).toHaveLength(1);
    expect(Number(mundo.usuariosDeCliente[0].createdBy)).toBe(40);
    expect(mundo.usuariosDeCliente[0].createdByClientUserId).toBeNull();
    // Y sigue sin poder nacer administrador desde ninguna de las dos puertas.
    expect(mundo.usuariosDeCliente[0].isAdmin).toBe(0);
  });

  it('si el empleado que invitó queda desactivado, el enlace se invalida solo', async () => {
    const mundo = mundoVacio();
    const secret = await invitacionDeLaCasa(mundo);
    mundo.personal[0].isActive = 0;

    await expect(
      crearServicio(mundo).accept({
        secret,
        password: 'unaClaveLarga1',
        passwordConfirmation: 'unaClaveLarga1',
      }),
    ).rejects.toThrow(INVITATION_INVALID_MESSAGE);
  });

  it('la vista previa responde EXACTAMENTE lo mismo en ese caso: las dos rutas no pueden divergir', async () => {
    const mundo = mundoVacio();
    const secret = await invitacionDeLaCasa(mundo);
    mundo.personal[0].isActive = 0;

    await expect(crearServicio(mundo).preview(secret)).rejects.toThrow(INVITATION_INVALID_MESSAGE);
  });

  it('la vista previa saluda mientras el empleado siga activo', async () => {
    const mundo = mundoVacio();
    const secret = await invitacionDeLaCasa(mundo);

    await expect(crearServicio(mundo).preview(secret)).resolves.toEqual({
      fullName: 'Ana Pérez',
      clientName: 'ACME',
    });
  });

  it('una fila SIN ninguno de los dos autores es enlace no válido — falla cerrado', async () => {
    const mundo = mundoVacio();
    const secret = 'A'.repeat(43);
    mundo.invitaciones.push(filaGuardada({ invitedByClientUserId: null, invitedByUserId: null }, secret));

    await expect(crearServicio(mundo).preview(secret)).rejects.toThrow(INVITATION_INVALID_MESSAGE);
  });
});

describe('reenviar — la autoría de ayer ni se rellena ni se reescribe', () => {
  it('una invitación de la casa se reenvía CON SU EMPLEADO, no convertida en invitación de cliente', async () => {
    const mundo = mundoVacio();
    mundo.invitaciones.push(filaGuardada({ invitedByUserId: 40 }));

    const vista = await crearServicio(mundo).resend(7, 1);

    // Se crea una nueva, y la nueva sigue siendo de la casa.
    expect(mundo.invitaciones).toHaveLength(2);
    const nueva = mundo.invitaciones[1];
    expect(Number(nueva.invitedByUserId)).toBe(40);
    expect(nueva.invitedByClientUserId).toBeNull();
    expect(vista.email).toBe('ana@x.com');
    expect(mundo.correosEnviados).toHaveLength(1);
  });

  it('una invitación del portal se reenvía con SU administrador, no atribuida a la casa', async () => {
    const mundo = mundoVacio();
    mundo.invitaciones.push(filaGuardada({ invitedByClientUserId: 3 }));

    await crearServicio(mundo).resend(7, 1);

    const nueva = mundo.invitaciones[1];
    expect(Number(nueva.invitedByClientUserId)).toBe(3);
    expect(nueva.invitedByUserId).toBeNull();
  });

  it('una invitación SIN autor no se reenvía: 404, y no se escribe ni se manda nada', async () => {
    const mundo = mundoVacio();
    mundo.invitaciones.push(filaGuardada({ invitedByClientUserId: null, invitedByUserId: null }));

    // Rellenar el autor que falta —con quien pulsa reenviar, con el primero
    // que haya— es exactamente lo que la decisión 8 de R4 prohíbe: la fila
    // diría que invitó alguien que no invitó.
    await expect(crearServicio(mundo).resend(7, 1)).rejects.toThrow(NotFoundException);
    expect(mundo.invitaciones).toHaveLength(1);
    expect(mundo.correosEnviados).toHaveLength(0);
  });

  it('reenviar una invitación de otra empresa es 404, no 403, y tampoco escribe', async () => {
    const mundo = mundoVacio();
    mundo.invitaciones.push(filaGuardada({ clientId: 99, invitedByUserId: 40 }));

    await expect(crearServicio(mundo).resend(7, 1)).rejects.toThrow(NotFoundException);
    expect(mundo.invitaciones).toHaveLength(1);
  });
});

/**
 * **La trampa que ya ha mordido varias veces en este repositorio:** TypeORM
 * hidrata toda columna `bigint` como CADENA aunque la entidad la declare
 * `number` (ver `common/ids.ts`). Los dobles de prueba guardan números, así
 * que un `===` o un `Number()` que falte no se nota aquí y sí en producción.
 *
 * Por eso estos casos meten el identificador del autor tal y como llega de la
 * base, `"40"` y `"3"`, y comprueban los dos caminos que lo leen: reenviar
 * —que lo copia a la fila nueva— y aceptar —que lo copia al usuario—.
 */
describe('el identificador del autor llega como cadena desde la base', () => {
  it('reenviar conserva al empleado aunque su id venga como «40»', async () => {
    const mundo = mundoVacio();
    mundo.invitaciones.push(filaGuardada({ invitedByUserId: '40' as unknown as number }));

    await crearServicio(mundo).resend(7, 1);

    const nueva = mundo.invitaciones[1];
    // Número, no cadena: lo que se escribe en la columna de autor sale del
    // tipo unión, que lo lleva ya convertido.
    expect(nueva.invitedByUserId).toBe(40);
    expect(nueva.invitedByClientUserId).toBeNull();
  });

  it('aceptar escribe created_by como NÚMERO aunque la invitación traiga «40»', async () => {
    const mundo = mundoVacio();
    const secret = 'B'.repeat(43);
    mundo.invitaciones.push(
      filaGuardada({ invitedByUserId: '40' as unknown as number }, secret),
    );

    await crearServicio(mundo).accept({
      secret,
      password: 'unaClaveLarga1',
      passwordConfirmation: 'unaClaveLarga1',
    });

    expect(mundo.usuariosDeCliente).toHaveLength(1);
    expect(mundo.usuariosDeCliente[0].createdBy).toBe(40);
    expect(mundo.usuariosDeCliente[0].createdByClientUserId).toBeNull();
  });

  it('la vista previa saluda con el empleado «40»: comprobar si sigue activo también convierte', async () => {
    const mundo = mundoVacio();
    const secret = 'C'.repeat(43);
    mundo.invitaciones.push(
      filaGuardada({ invitedByUserId: '40' as unknown as number }, secret),
    );

    await expect(crearServicio(mundo).preview(secret)).resolves.toEqual({
      fullName: 'Ana Pérez',
      clientName: 'ACME',
    });
  });

  it('y lo mismo por el camino del portal: «3» aceptado escribe el 3 en la columna de cliente', async () => {
    const mundo = mundoVacio();
    const secret = 'D'.repeat(43);
    mundo.usuariosDeCliente.push({ id: 3, clientId: 7, isActive: 1 } as ClientUser);
    mundo.invitaciones.push(
      filaGuardada(
        { invitedByClientUserId: '3' as unknown as number, email: 'otra@x.com' },
        secret,
      ),
    );

    await crearServicio(mundo).accept({
      secret,
      password: 'unaClaveLarga1',
      passwordConfirmation: 'unaClaveLarga1',
    });

    const nuevo = mundo.usuariosDeCliente[1];
    expect(nuevo.createdByClientUserId).toBe(3);
    expect(nuevo.createdBy).toBeNull();
  });
});

describe('un autor sin identificador utilizable no escribe nada', () => {
  it.each([0, -1, Number.NaN])('STAFF con userId %s se rechaza antes de tocar la base', async (malo) => {
    const mundo = mundoVacio();
    await expect(crearServicio(mundo).invite(7, { kind: 'STAFF', userId: malo }, DTO)).rejects.toThrow();
    expect(mundo.invitaciones).toHaveLength(0);
    expect(mundo.correosEnviados).toHaveLength(0);
  });
});
