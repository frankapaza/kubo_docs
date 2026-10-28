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
    findPendingByIdForClient: async () => null,
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
    mundo.invitaciones.push({
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
    } as ClientUserInvitation);

    await expect(crearServicio(mundo).preview(secret)).rejects.toThrow(INVITATION_INVALID_MESSAGE);
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
