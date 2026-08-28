import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { PORTAL_INVITATION_THROTTLE } from '../../config/throttler.config';
import { PortalInvitationsService } from './portal-invitations.service';
import { AcceptInvitationDto, InvitationPreviewView } from './dto/accept-invitation.dto';

/**
 * **La única ruta del portal sin sesión que entrega una credencial.**
 *
 * Sin `ClientJwtGuard` a propósito: quien acepta una invitación todavía no
 * tiene cuenta, así que no puede tener token. Lo que sí lleva es el tope de
 * intentos, igual que `PortalAuthController` — el guard va a nivel de
 * controlador para que la segunda ruta de aquí abajo lo herede sin que nadie
 * tenga que acordarse.
 *
 * **Sí hay una ruta `GET`, y es de solo lectura a propósito** (`preview`, más
 * abajo): responde «este enlace vale» sin consumirlo, pero con el mismo cuerpo
 * único ante cualquier motivo de invalidez que usa `accept` — así no abre el
 * oráculo que ese cuerpo único existe para negar. Ver
 * `PortalInvitationsService.preview`.
 */
@Controller('portal/invitaciones')
@UseGuards(ApiThrottlerGuard)
export class PortalInvitationsController {
  constructor(private readonly service: PortalInvitationsService) {}

  /**
   * Devuelve solo el correo con el que entrar. **No emite tokens**: la persona
   * pasa por el login como cualquier otra, y así esta ruta pública nunca es una
   * vía para obtener una sesión sin escribir una contraseña.
   */
  @Post('aceptar')
  @HttpCode(200)
  @Throttle(PORTAL_INVITATION_THROTTLE)
  accept(@Body() dto: AcceptInvitationDto): Promise<{ email: string }> {
    return this.service.accept(dto);
  }

  /**
   * Lo que ve la pantalla de aceptar antes de pedir contraseña: el nombre de
   * la persona invitada y el de su empresa. Decisión 10 de la spec.
   *
   * No consume la invitación (ver `PortalInvitationsService.preview`), y
   * lleva el MISMO tope de intentos que aceptar: el coste es aceptable
   * porque el secreto son 32 bytes al azar —no se puede enumerar— y esta
   * ruta no dice nada que quien ya tiene el enlace no fuera a ver un segundo
   * después.
   */
  @Get(':secret')
  @Throttle(PORTAL_INVITATION_THROTTLE)
  preview(@Param('secret') secret: string): Promise<InvitationPreviewView> {
    return this.service.preview(secret);
  }
}
