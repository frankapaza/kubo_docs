import {
  BadRequestException,
  Body,
  CallHandler,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpException,
  Injectable,
  NestInterceptor,
  Param,
  ParseIntPipe,
  PayloadTooLargeException,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Observable, catchError, throwError } from 'rxjs';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { serveAttachment } from '../../common/http/attachment-response';
import { decodeMultipartFilename } from '../../common/http/multipart-filename';
import { DOC_UPLOAD_LIMITS, MAX_DOC_BYTES, WorkItemDocKind } from './domain/work-item-docs';
import { WorkItemDocumentsService } from './work-item-documents.service';

/** El 413 de multer llega en inglés («File too large»): se traduce con el mismo tope del dominio. */
@Injectable()
export class DocUploadErrorsInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((e) => {
        const status = e instanceof HttpException ? e.getStatus() : 0;
        const body = e instanceof HttpException ? (e.getResponse() as { code?: string }) : null;
        if (status === 413 && !body?.code) {
          return throwError(
            () =>
              new PayloadTooLargeException({
                code: 'PAYLOAD_TOO_LARGE',
                message: `El archivo supera el máximo de ${MAX_DOC_BYTES / (1024 * 1024)} MB.`,
              }),
          );
        }
        return throwError(() => e);
      }),
    );
  }
}

/** Documentos de un requerimiento (Especificación, Manual, Acta, otros). Solo el equipo. */
@Controller('work-items/:id/documents')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class WorkItemDocumentsController {
  constructor(private readonly docs: WorkItemDocumentsService) {}

  @Get()
  list(@Param('id', ParseIntPipe) id: number) {
    return this.docs.list(id);
  }

  @Post()
  @UseInterceptors(DocUploadErrorsInterceptor, FileInterceptor('file', { limits: DOC_UPLOAD_LIMITS }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('kind') kind: string,
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Falta el archivo en el campo «file».' });
    }
    return this.docs.upload({
      workItemId: id,
      actorUserId: user.id,
      kind: String(kind ?? 'OTRO').toUpperCase() as WorkItemDocKind,
      buffer: file.buffer,
      filename: decodeMultipartFilename(file.originalname),
    });
  }

  @Get(':docId/download')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Param('docId', ParseIntPipe) docId: number,
    @Res() res: Response,
  ): Promise<void> {
    await serveAttachment(res, await this.docs.download(id, docId));
  }

  @Post(':docId/approve')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    return this.docs.approve(id, docId, user.id);
  }

  @Delete(':docId')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    await this.docs.remove(id, docId, user.id);
    return { ok: true };
  }
}
