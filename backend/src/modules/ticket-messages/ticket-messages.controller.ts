import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import { serveAttachment } from '../../common/http/attachment-response';
import { decodeMultipartFilename } from '../../common/http/multipart-filename';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { ATTACHMENT_UPLOAD_LIMITS } from './domain/attachment-rules';
import { CreateMessageDto } from './dto/create-message.dto';
import { AttachmentUploadErrorsInterceptor } from './interceptors/attachment-upload-errors.interceptor';
import { TicketAttachmentsService } from './ticket-attachments.service';
import { TicketMessageActor, TicketMessagesService } from './ticket-messages.service';

/**
 * `ParseIntPipe` de serie contesta «Validation failed (numeric string is
 * expected)»: inglés y jerga de framework. Se le da la forma `{ code, message }`
 * del proyecto, igual que en `portal-tickets.controller.ts`.
 */
const idPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'El identificador no es válido.',
    }),
});

/**
 * El hilo de un ticket y sus adjuntos, para el **panel interno**. El portal
 * tiene su propia superficie y su propio guard.
 *
 * Este controlador no toma **ninguna** decisión de visibilidad, de autoría ni
 * de pertenencia: construye el actor del equipo con el id del token, se lo pasa
 * al servicio y devuelve lo que le dé. Quién es el autor, qué visibilidad tiene
 * el mensaje, de quién es el ticket y qué adjuntos se pueden ver lo decide
 * `TicketMessagesService` / `TicketAttachmentsService`, que es donde están las
 * tres invariantes y donde las comprueban también las peticiones del portal.
 * Repartir esa política entre dos capas es exactamente cómo se actualiza una y
 * se olvida la otra.
 *
 * `RolesGuard` va montado por coherencia con el resto del panel, pero ninguna
 * ruta declara `@Roles`: responder en un ticket, escribir una nota interna y
 * adjuntar un fichero es trabajo de soporte, no de administración. Lo que
 * `@Roles('ADMIN')` protege en los controladores hermanos son catálogos
 * (`support-agents`, plantillas), no el trabajo del día.
 */
@Controller()
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class TicketMessagesController {
  constructor(
    private readonly messages: TicketMessagesService,
    private readonly attachments: TicketAttachmentsService,
  ) {}

  @Get('tickets/:ticketId/messages')
  listThread(@CurrentUser() user: AuthUser, @Param('ticketId', idPipe) ticketId: number) {
    return this.messages.listThread(staffActor(user), ticketId);
  }

  @Post('tickets/:ticketId/messages')
  post(
    @CurrentUser() user: AuthUser,
    @Param('ticketId', idPipe) ticketId: number,
    @Body() dto: CreateMessageDto,
  ) {
    // `visibility` viaja tal cual, incluido `undefined`: el servicio es quien
    // decide, y para un actor del equipo su omisión ya significa `PUBLICA`.
    return this.messages.post(staffActor(user), ticketId, {
      bodyMd: dto.bodyMd,
      visibility: dto.visibility,
    });
  }

  @Get('tickets/:ticketId/attachments')
  listAttachments(@CurrentUser() user: AuthUser, @Param('ticketId', idPipe) ticketId: number) {
    return this.attachments.list(staffActor(user), ticketId);
  }

  /**
   * Sube un adjunto **a un mensaje**. El `messageId` va en la ruta y no en el
   * cuerpo porque no es opcional: un adjunto sin mensaje no hereda ninguna
   * visibilidad, y el servicio lo rechaza. Que la propia URL lo exija evita que
   * la petición llegue a existir.
   */
  @Post('tickets/:ticketId/messages/:messageId/attachments')
  // El orden importa: el traductor va **por delante**, porque es su
  // `next.handle()` el que envuelve a `FileInterceptor` y el único sitio desde
  // el que se ve el error que produce la propia subida.
  @UseInterceptors(
    AttachmentUploadErrorsInterceptor,
    FileInterceptor('file', { limits: ATTACHMENT_UPLOAD_LIMITS }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('ticketId', idPipe) ticketId: number,
    @Param('messageId', idPipe) messageId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Falta el archivo a adjuntar en el campo «file».',
      });
    }

    // Lo que llega de multer, con los nombres que el dominio usa para recordar
    // de qué se fía: `declaredMime` y `declaredSize` los pone quien sube y no
    // deciden nada; la autoridad es el buffer.
    return this.attachments.upload(staffActor(user), ticketId, messageId, {
      buffer: file.buffer,
      declaredMime: file.mimetype,
      filename: decodeMultipartFilename(file.originalname),
      declaredSize: file.size,
    });
  }

  /**
   * Sirve el fichero. Cuelga de `attachments/:id` y no de `tickets/:ticketId/…`
   * a propósito: el servicio localiza el adjunto por su id y comprueba desde él
   * de quién es el ticket, así que un `ticketId` en la ruta sería un dato que
   * nadie contrasta -- y una ruta que parece comprobar algo que no comprueba es
   * peor que no tenerla.
   */
  @Get('attachments/:attachmentId/download')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('attachmentId', idPipe) attachmentId: number,
    @Res() res: Response,
  ): Promise<void> {
    // Si esto lanza (404 del servicio), no se ha escrito ninguna cabecera y el
    // filtro global puede contestar con su JSON de siempre.
    const download = await this.attachments.download(staffActor(user), attachmentId);

    // Forzada, con `nosniff`, con el nombre ASCII en el `filename=` y soltando
    // el flujo pase lo que pase. Vive en `common/http` porque el portal sirve
    // exactamente igual: ver `serveAttachment`, que es donde está el porqué de
    // cada una de esas cuatro cosas.
    await serveAttachment(res, download);
  }
}

/**
 * El actor del equipo, y el único que este controlador sabe construir.
 *
 * Sale del `id` que `JwtAuthGuard` dejó en la petición, sin ninguna rama: no
 * hay aquí ningún «si falta tal cosa, entonces…». Y no lo hay porque el `if`
 * está donde tiene que estar, no porque no haga falta: `JwtStrategy.validate`
 * copia el `sub` del payload **sin comprobarlo**, así que un token manipulado
 * con `sub: 0` sí llega hasta aquí. Quien falla cerrado es `resolveScope` en el
 * servicio, que exige un entero positivo a los dos lados --no `resolveActorIds`,
 * que reparte el valor tal cual sin mirarlo.
 */
function staffActor(user: AuthUser): TicketMessageActor {
  return { kind: 'STAFF', userId: user.id };
}
