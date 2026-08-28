import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ClientJwtGuard } from './guards/client-jwt.guard';
import { ClientAdminGuard } from './guards/client-admin.guard';
import { CurrentClientUser } from './decorators/current-client-user.decorator';
import { AuthClientUser } from './strategies/client-jwt.strategy';
import { PortalUsersService } from './portal-users.service';
import { PortalInvitationsService } from './portal-invitations.service';
import { InvitePortalUserDto, PortalClientUserView, PortalInvitationView } from './dto/portal-user.dto';

const userIdPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'El identificador del usuario no es válido.',
    }),
});

/**
 * La gente de la propia empresa, gestionada por su administrador.
 *
 * **Ninguna ruta acepta `clientId`**: el único que existe aquí es el del token
 * que `ClientJwtGuard` acaba de verificar. Mismo criterio que
 * `PortalRequirementsController`.
 *
 * `ClientAdminGuard` va a nivel de controlador, no por ruta: aquí no hay nada
 * que un usuario normal deba poder hacer —ni siquiera listar—, y ponerlo
 * arriba hace que una ruta nueva lo herede sin que nadie tenga que acordarse.
 */
@Controller('portal/usuarios')
@UseGuards(ClientJwtGuard, ClientAdminGuard)
export class PortalUsersController {
  constructor(
    private readonly service: PortalUsersService,
    private readonly invitations: PortalInvitationsService,
  ) {}

  @Get()
  list(@CurrentClientUser() user: AuthClientUser): Promise<PortalClientUserView[]> {
    return this.service.list(user.clientId);
  }

  /**
   * Las invitaciones pendientes de esta empresa. Van en este controlador y no
   * en uno propio porque son la otra mitad de la misma pantalla: una persona
   * invitada todavía no es un usuario, pero el administrador la ve en la misma
   * lista y necesita saber que sigue pendiente.
   */
  @Get('invitaciones')
  listInvitations(@CurrentClientUser() user: AuthClientUser): Promise<PortalInvitationView[]> {
    return this.invitations.listPending(user.clientId);
  }

  @Post('invitaciones')
  invite(
    @CurrentClientUser() user: AuthClientUser,
    @Body() dto: InvitePortalUserDto,
  ): Promise<PortalInvitationView> {
    // Los dos identificadores salen del token que `ClientJwtGuard` acaba de
    // verificar. El cuerpo solo aporta nombre y correo.
    return this.invitations.invite(user.clientId, user.clientUserId, dto);
  }

  /**
   * Reintento visible del correo de invitación (decisión 6 de la spec): sin
   * cola no hay reintento automático, así que esta ruta es el reintento. Emite
   * un secreto nuevo y revoca el anterior — nunca reenvía el mismo enlace,
   * porque del viejo solo se guarda su huella.
   */
  @Post('invitaciones/:id/reenviar')
  @HttpCode(200)
  resend(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', userIdPipe) id: number,
  ): Promise<PortalInvitationView> {
    return this.invitations.resend(user.clientId, id);
  }

  /**
   * `POST` y no `DELETE`: no se borra nada. El usuario sigue existiendo con
   * todo su rastro; lo que se quita es el acceso (decisión 4 de la spec).
   */
  @Post(':id/desactivar')
  @HttpCode(200)
  deactivate(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', userIdPipe) id: number,
  ): Promise<PortalClientUserView> {
    return this.service.deactivate(user.clientId, user.clientUserId, id);
  }
}
