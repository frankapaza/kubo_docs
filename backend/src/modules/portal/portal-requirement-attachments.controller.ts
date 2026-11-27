import {
  BadRequestException,
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
import { DOC_UPLOAD_LIMITS } from '../work-items/domain/work-item-docs';
import { DocUploadErrorsInterceptor } from '../work-items/work-item-documents.controller';

import { ClientJwtGuard } from './guards/client-jwt.guard';
import { ClientAdminGuard } from './guards/client-admin.guard';
import { CurrentClientUser } from './decorators/current-client-user.decorator';
import { AuthClientUser } from './strategies/client-jwt.strategy';
import {
  PortalRequirementAttachmentView,
  PortalRequirementAttachmentsService,
} from './portal-requirement-attachments.service';

const idPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new BadRequestException({ code: 'VALIDATION_ERROR', message: 'El identificador no es válido.' }),
});

/**
 * Archivos que el cliente adjunta a su requerimiento. Ninguna ruta acepta
 * `clientId`: sale del token. Subir pide el mismo permiso que pedir un
 * requerimiento (`ClientAdminGuard`); ver y descargar, cualquiera de la empresa.
 */
@Controller('portal/requerimientos/:id/adjuntos')
@UseGuards(ClientJwtGuard)
export class PortalRequirementAttachmentsController {
  constructor(private readonly service: PortalRequirementAttachmentsService) {}

  @Get()
  list(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', idPipe) id: number,
  ): Promise<PortalRequirementAttachmentView[]> {
    return this.service.list(user.clientId, id);
  }

  @Post()
  @UseGuards(ClientAdminGuard)
  @UseInterceptors(DocUploadErrorsInterceptor, FileInterceptor('file', { limits: DOC_UPLOAD_LIMITS }))
  upload(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', idPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<PortalRequirementAttachmentView> {
    if (!file) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Falta el archivo en el campo «file».' });
    }
    return this.service.upload(user.clientUserId, user.clientId, id, {
      buffer: file.buffer,
      filename: decodeMultipartFilename(file.originalname),
    });
  }

  @Get(':docId/download')
  async download(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', idPipe) id: number,
    @Param('docId', idPipe) docId: number,
    @Res() res: Response,
  ): Promise<void> {
    await serveAttachment(res, await this.service.download(user.clientId, id, docId));
  }
}
