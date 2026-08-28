import { BadRequestException, Injectable } from '@nestjs/common';

import { ClientUsersRepository } from './client-users.repository';
import { ClientUserInvitationsRepository } from './client-user-invitations.repository';
import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { InvitePortalUserDto, PortalInvitationView } from './dto/portal-user.dto';
import {
  fingerprintInvitationSecret,
  generateInvitationSecret,
  invitationExpiryFrom,
} from './domain/invitation-secret';
import { assertSessionScope, toIso } from './session-scope';
import { sameId } from '../../common/ids';

/**
 * Único texto para cualquier motivo por el que no se puede invitar a una
 * dirección: ya es de un usuario de esta empresa, ya es de un usuario de otra,
 * o ya tiene una invitación viva en otra.
 *
 * Decisión 7 de la spec: distinguirlos convertiría el portal en un comprobador
 * de quiénes son nuestros clientes. La consecuencia conocida y aceptada es que
 * un administrador que se equivoque tecleando no sabrá exactamente por qué
 * falla — por eso el texto le dice qué hacer.
 */
export const INVITE_REJECTED_MESSAGE =
  'No se puede invitar a esa dirección. Revisa que esté bien escrita, ' +
  'o escríbenos si crees que debería poder entrar.';

@Injectable()
export class PortalInvitationsService {
  constructor(
    private readonly invitations: ClientUserInvitationsRepository,
    private readonly clientUsers: ClientUsersRepository,
  ) {}

  /**
   * Crea la invitación y devuelve la vista. **El secreto no sale por aquí**:
   * quien necesita mandarlo por correo usa `inviteWithSecret`.
   */
  async invite(
    clientId: number,
    invitedByClientUserId: number,
    dto: InvitePortalUserDto,
  ): Promise<PortalInvitationView> {
    const { view } = await this.inviteWithSecret(clientId, invitedByClientUserId, dto);
    return view;
  }

  /**
   * El alta de verdad. Devuelve la vista **y** el secreto en claro, que existe
   * solo en esta variable y en el correo que sale: no se guarda, no se registra
   * en ningún log y no se devuelve por HTTP.
   */
  async inviteWithSecret(
    clientId: number,
    invitedByClientUserId: number,
    dto: InvitePortalUserDto,
  ): Promise<{ view: PortalInvitationView; secret: string; invitation: ClientUserInvitation }> {
    // Los dos, y antes de tocar la base: un clientId falsy haría desaparecer
    // el filtro de empresa, y un clientUserId falsy dejaría la invitación sin
    // autor real.
    assertSessionScope(clientId, 'clientId', PortalInvitationsService.name);
    assertSessionScope(invitedByClientUserId, 'clientUserId', PortalInvitationsService.name);

    const ahora = new Date();

    // El correo es único en `client_users` para TODO el sistema (ver la clave
    // `uq_client_users_email` de la 013), así que esta comprobación es global
    // a propósito: si la dirección ya es de alguien, da igual de qué empresa.
    const yaEsUsuario = await this.clientUsers.findByEmail(dto.email);
    if (yaEsUsuario) throw invitacionRechazada();

    const viva = await this.invitations.findLiveByEmail(dto.email, ahora);
    if (viva && !sameId(viva.clientId, clientId)) {
      // Viva en OTRA empresa: se rechaza y no se le toca la suya. Anularla
      // sería un efecto cruzado entre empresas, aunque no revele nada.
      throw invitacionRechazada();
    }
    if (viva) {
      // Viva en la propia: se reemplaza. Primero revocar y después crear —al
      // revés, durante un instante habría dos vivas y la revocación se
      // llevaría por delante la recién creada.
      await this.invitations.revokeLiveByEmail(dto.email, clientId, ahora);
    }

    const secret = generateInvitationSecret();
    const invitation = await this.invitations.create({
      clientId,
      email: dto.email,
      fullName: dto.fullName.trim(),
      // La huella, jamás el secreto.
      secretFingerprint: fingerprintInvitationSecret(secret),
      invitedByClientUserId,
      expiresAt: invitationExpiryFrom(ahora),
    });

    // Campo a campo, y sin ningún campo de rol: no hay por dónde colar un
    // `isAdmin` que llegara en el cuerpo, porque este objeto no lo tiene.
    return { view: toInvitationView(invitation), secret, invitation };
  }

  async listPending(clientId: number): Promise<PortalInvitationView[]> {
    assertSessionScope(clientId, 'clientId', PortalInvitationsService.name);
    const filas = await this.invitations.listPendingByClient(clientId, new Date());
    return filas.map(toInvitationView);
  }
}

function invitacionRechazada(): BadRequestException {
  return new BadRequestException({
    code: 'INVITACION_RECHAZADA',
    message: INVITE_REJECTED_MESSAGE,
  });
}

/**
 * Lista blanca campo a campo. `secretFingerprint` no aparece, y no puede
 * aparecer por descuido porque no hay ningún spread de la entidad.
 */
export function toInvitationView(i: ClientUserInvitation): PortalInvitationView {
  return {
    id: Number(i.id),
    fullName: i.fullName,
    email: i.email,
    expiresAt: toIso(i.expiresAt)!,
    lastSentAt: toIso(i.lastSentAt),
    // Por el hecho, no por la ausencia: hay fallo si hay TEXTO de error, no si
    // falta `lastSentAt` (que solo significa "todavía no se intentó").
    deliveryFailed: !!i.sendError,
    createdAt: toIso(i.createdAt)!,
  };
}
