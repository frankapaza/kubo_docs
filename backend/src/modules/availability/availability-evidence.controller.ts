import {
  Body, CallHandler, Controller, Delete, ExecutionContext, Get, HttpCode, Injectable, NestInterceptor, Param,
  ParseIntPipe, PayloadTooLargeException, Post, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Observable, catchError, throwError } from 'rxjs';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { AvailabilityEvidenceService, contentDisposition, EVIDENCE_MAX_BYTES } from './availability-evidence.service';
import { UploadEvidenceDto } from './dto/evidence.dto';

/** Traduce el rechazo de multer por tamaño al formato `{ code, message }` de la casa (413). */
@Injectable()
export class EvidenceUploadErrorsInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((e) =>
        throwError(() =>
          e instanceof PayloadTooLargeException
            ? new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'El archivo supera el máximo de 2 MB' })
            : e,
        ),
      ),
    );
  }
}

/** Evidencia WinMTR de un incidente: subir y descargar, cualquier usuario del personal; borrar, solo ADMIN. */
@Controller('availability')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class AvailabilityEvidenceController {
  constructor(private readonly evidence: AvailabilityEvidenceService) {}

  @Post('incidents/:id/evidence')
  @UseInterceptors(EvidenceUploadErrorsInterceptor, FileInterceptor('file', { limits: { fileSize: EVIDENCE_MAX_BYTES } }))
  upload(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadEvidenceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.evidence.upload(id, file, dto, user.id);
  }

  @Get('evidence/:id/file')
  async file(@Param('id', ParseIntPipe) id: number, @Res() res: Response): Promise<void> {
    const f = await this.evidence.openFile(id);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(f.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    f.stream.pipe(res);
  }

  @Delete('evidence/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.evidence.remove(id);
  }
}
