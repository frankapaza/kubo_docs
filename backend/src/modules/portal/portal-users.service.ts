import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { sameId } from '../../common/ids';
import { ClientUsersRepository } from './client-users.repository';
import { ClientUser } from './entities/client-user.entity';
import { PortalClientUserView } from './dto/portal-user.dto';
import { assertSessionScope, toIso } from './session-scope';

/**
 * La gente de una empresa cliente, vista y gestionada por su propio
 * administrador. `clientId` y `actorClientUserId` entran SIEMPRE por argumento
 * desde el token — nunca desde el cuerpo, la URL ni la query.
 */
@Injectable()
export class PortalUsersService {
  constructor(private readonly repo: ClientUsersRepository) {}

  async list(clientId: number): Promise<PortalClientUserView[]> {
    assertSessionScope(clientId, 'clientId', PortalUsersService.name);
    const filas = await this.repo.listByClient(clientId);
    return filas.map(toPortalView);
  }

  /**
   * Le quita el acceso a alguien de su empresa.
   *
   * Tres comprobaciones y en este orden:
   *  1. que el usuario sea de esta empresa (si no, 404) — sin esto, un
   *     administrador podría averiguar por el mensaje de error que un id
   *     ajeno existe de verdad;
   *  2. que no sea uno mismo (decisión 5 de la spec);
   *  3. que no sea OTRO administrador (decisión 9 de la spec).
   *
   * Las dos últimas son guardas DISTINTAS, no una la reformulación de la
   * otra: hoy coinciden siempre en que quien pide es administrador (lo exige
   * `ClientAdminGuard`), pero cada una protege un caso distinto —"no te
   * quedes tú sin acceso" frente a "no le quites el acceso a otro que
   * tampoco creaste"— y las dos se quedan aunque el día de mañana alguien
   * afloje una.
   */
  async deactivate(
    clientId: number,
    actorClientUserId: number,
    targetId: number,
  ): Promise<PortalClientUserView> {
    assertSessionScope(clientId, 'clientId', PortalUsersService.name);
    assertSessionScope(actorClientUserId, 'clientUserId', PortalUsersService.name);

    const usuario = await this.repo.findById(targetId);
    // `sameId` y no `===`: TypeORM devuelve `client_id` como cadena y el del
    // token es un número de verdad. Con la comparación estricta, el dueño
    // legítimo se comería un 404.
    if (!usuario || !sameId(usuario.clientId, clientId)) throw this.noExiste();

    if (sameId(usuario.id, actorClientUserId)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'No puedes quitarte a ti mismo el acceso: la empresa se quedaría sin administrador.',
      });
    }

    // Decisión 9 de la spec. Si el administrador de cliente no puede nombrar
    // administradores (decisión 2), tampoco puede quitarles el acceso: solo
    // a los usuarios normales que sí puede crear. `usuario.isAdmin` llega
    // como `0`/`1` desde la fila cruda del repositorio, no como booleano —
    // por eso la comprobación es de verdad (truthy), no `=== true`.
    if (usuario.isAdmin) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'No puedes quitarle el acceso a otro administrador de tu empresa.',
      });
    }

    await this.repo.deactivate(Number(usuario.id));
    return toPortalView({ ...usuario, isActive: 0 });
  }

  /**
   * Un usuario de otra empresa y uno que no existe dan exactamente esta misma
   * respuesta. Distinguirlos confirmaría cuáles existen de verdad — de ahí
   * 404 y nunca 403.
   */
  private noExiste(): NotFoundException {
    return new NotFoundException({
      code: 'NOT_FOUND',
      message: 'Usuario no encontrado',
    });
  }
}

/**
 * Lista blanca campo a campo. Nunca `{...u}` menos claves: eso publica por
 * omisión cualquier columna que alguien añada mañana a la entidad, empezando
 * por `passwordHash`.
 */
function toPortalView(u: ClientUser): PortalClientUserView {
  return {
    id: Number(u.id),
    fullName: u.fullName,
    email: u.email,
    isAdmin: !!u.isAdmin,
    isActive: !!u.isActive,
    lastLoginAt: toIso(u.lastLoginAt),
    createdAt: toIso(u.createdAt)!,
  };
}
