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
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Response } from 'express';
import { Observable, catchError, throwError } from 'rxjs';

import { AuthUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../../common/guards/staff-only.guard';
import { serveAttachment } from '../../../common/http/attachment-response';
import { decodeMultipartFilename } from '../../../common/http/multipart-filename';
import { ProjectsService } from '../projects.service';
import { WORK_TYPES, WorkType, assertWorkType } from './deliverable-catalog';
import { DELIVERABLE_UPLOAD_LIMITS, MAX_DELIVERABLE_BYTES } from './deliverable-files';
import { ExpedienteService } from './expediente.service';

export class SetWorkTypeDto {
  @IsIn(WORK_TYPES as unknown as string[])
  workType!: WorkType;
}

export class AddDeliverableDto {
  @IsString()
  @MaxLength(10)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;
}

export class DeliverableNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** El 413 de multer llega en inglés: se traduce con el tope del expediente. */
@Injectable()
export class DeliverableUploadErrorsInterceptor implements NestInterceptor {
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
                message: `El archivo supera el máximo de ${MAX_DELIVERABLE_BYTES / (1024 * 1024)} MB.`,
              }),
          );
        }
        return throwError(() => e);
      }),
    );
  }
}

function noteOf(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw);
  if (s.length > 1000) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: 'La nota admite hasta 1000 caracteres.' });
  }
  return s;
}

/**
 * El expediente de un proyecto. Cada ruta comprueba primero que el usuario
 * puede ver el proyecto (`findByIdForUser`) y el servicio busca el entregable
 * dentro de ese proyecto: no se llega al de otro proyecto cambiando el id.
 * Aprobar, firmar, «no aplica» y el tipo de trabajo son de quien dirige el proyecto.
 */
@Controller('projects/:projectId/expediente')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class ExpedienteController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly expediente: ExpedienteService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser, @Param('projectId', ParseIntPipe) projectId: number) {
    return this.expediente.get(await this.projects.findByIdForUser(projectId, user));
  }

  @Put('work-type')
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  async setWorkType(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: SetWorkTypeDto,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.expediente.setWorkType(project, assertWorkType(dto.workType), user.id);
  }

  @Get('zip')
  async zip(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Res() res: Response,
  ): Promise<void> {
    const z = await this.expediente.zip(await this.projects.findByIdForUser(projectId, user));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(z.buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${z.headerFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(z.buffer);
  }

  @Post('deliverables')
  async add(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: AddDeliverableDto,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.expediente.add(project, dto.type.toUpperCase(), dto.title ?? null);
  }

  @Delete('deliverables/:id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.expediente.remove(await this.projects.findByIdForUser(projectId, user), id);
    return { ok: true };
  }

  @Get('deliverables/:id/history')
  async history(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.expediente.history(await this.projects.findByIdForUser(projectId, user), id);
  }

  @Post('deliverables/:id/versions')
  @UseInterceptors(DeliverableUploadErrorsInterceptor, FileInterceptor('file', { limits: DELIVERABLE_UPLOAD_LIMITS }))
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('note') note: unknown,
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Falta el archivo en el campo «file».' });
    }
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.expediente.upload(
      project,
      id,
      { buffer: file.buffer, filename: decodeMultipartFilename(file.originalname), note: noteOf(note) },
      user.id,
    );
  }

  @Get('deliverables/:id/versions/:versionId/file')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Res() res: Response,
  ): Promise<void> {
    const project = await this.projects.findByIdForUser(projectId, user);
    await serveAttachment(res, await this.expediente.download(project, id, versionId));
  }

  @Post('deliverables/:id/submit')
  async submit(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverableNoteDto,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.expediente.submit(project, id, dto.note ?? null, user.id);
  }

  @Post('deliverables/:id/observe')
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  async observe(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverableNoteDto,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.expediente.observe(project, id, dto.note ?? null, user.id);
  }

  @Post('deliverables/:id/approve')
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverableNoteDto,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.expediente.approve(project, id, dto.note ?? null, user.id);
  }

  @Post('deliverables/:id/sign')
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  @UseInterceptors(DeliverableUploadErrorsInterceptor, FileInterceptor('file', { limits: DELIVERABLE_UPLOAD_LIMITS }))
  async sign(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('note') note: unknown,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    const upload = file
      ? { buffer: file.buffer, filename: decodeMultipartFilename(file.originalname) }
      : null;
    return this.expediente.sign(project, id, upload, noteOf(note), user.id);
  }

  @Post('deliverables/:id/not-applicable')
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  async notApplicable(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverableNoteDto,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.expediente.notApplicable(project, id, dto.note ?? null, user.id);
  }

  @Post('deliverables/:id/reopen')
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  async reopen(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.expediente.reopen(project, id, user.id);
  }
}
