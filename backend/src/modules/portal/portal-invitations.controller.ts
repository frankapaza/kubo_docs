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
 * Las dos rutas llevan los mismos límites (`PORTAL_INVITATION_THROTTLE`) pero
 * **cada una su propio contador**: la clave del throttler incluye el nombre
 * del manejador, así que desde una misma IP salen 5 aceptaciones por minuto
 * más 5 vistas previas. Es deliberado y está razonado en
 * `throttler.config.ts`; la prueba de `portal-invitations.controller.throttling.spec.ts`
 * lo fija por escrito para que nadie lo lea como un tope conjunto de 5.
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
   * lleva los MISMOS límites que aceptar: el coste es aceptable porque el
   * secreto son 32 bytes al azar —no se puede enumerar— y esta ruta no dice
   * nada que quien ya tiene el enlace no fuera a ver un segundo después.
   *
   * **El secreto viaja en la ruta, y eso tiene una consecuencia asumida que
   * conviene dejar por escrito.** Va en el path y no en la query porque los
   * intermediarios registran la query con más alegría (ver
   * `buildInvitationUrl`), pero `HttpExceptionFilter` copia `req.url` en
   * TODO cuerpo de error (campo `path`) y, además, escribe una traza con esa
   * misma URL cuando el estado es 5xx. O sea:
   *
   *  - En cualquier error de esta ruta el secreto vuelve dentro de la
   *    respuesta. Inofensivo: quien la recibe es quien acaba de mandarlo.
   *  - Ante un 500 —solo ahí; los siete motivos de invalidez son 400— el
   *    secreto acaba también en el log del servidor.
   *
   * Se acepta a cambio del saludo de la decisión 10, y porque el log del
   * servidor es el mismo sitio donde ya viven los datos de la petición. Lo
   * que no se acepta es que aparezca por sorpresa: si mañana el secreto no
   * puede tocar el log, lo que hay que mover es la ruta, no el filtro.
   */
  @Get(':secret')
  @Throttle(PORTAL_INVITATION_THROTTLE)
  preview(@Param('secret') secret: string): Promise<InvitationPreviewView> {
    return this.service.preview(secret);
  }
}
