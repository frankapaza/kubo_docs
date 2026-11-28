import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Response } from 'express';

import { AuthUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../../common/guards/staff-only.guard';
import { ProjectsService } from '../projects.service';
import { MAX_ATTACHMENT_BYTES, DeliverableDocumentService } from './deliverable-document.service';
import { ExpedienteService } from './expediente.service';

export class SaveDocumentDto {
  @IsArray()
  sections!: unknown[];

  @IsOptional()
  @IsString()
  @MaxLength(12)
  baseVersion?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AiAdjustDto {
  @IsIn(['SECTION', 'DOCUMENT'])
  scope!: 'SECTION' | 'DOCUMENT';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sectionKey?: string;

  @IsString()
  @MaxLength(500)
  instruction!: string;

  @IsArray()
  sections!: unknown[];
}

export class UpdateAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string | null;

  @IsOptional()
  @IsIn(['INLINE', 'ANEXO'])
  place?: 'INLINE' | 'ANEXO';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sectionKey?: string;
}

export class SaveTemplateDto {
  @IsOptional()
  clientId?: number | null;

  @IsString()
  @MaxLength(180)
  name!: string;

  @IsArray()
  sections!: unknown[];
}

/**
 * El documento en línea de un entregable (editor). Cada ruta comprueba antes
 * el acceso al proyecto; el servicio busca el entregable dentro de él.
 */
@Controller('projects/:projectId/expediente/deliverables/:id/document')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class DeliverableDocumentController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly expediente: ExpedienteService,
    private readonly docs: DeliverableDocumentService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser, @Param('projectId', ParseIntPipe) projectId: number, @Param('id', ParseIntPipe) id: number) {
    return this.docs.getDocument(await this.projects.findByIdForUser(projectId, user), id);
  }

  @Put()
  async save(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveDocumentDto,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    await this.expediente.saveDocument(project, id, dto.sections, dto.baseVersion ?? null, dto.note ?? null, user.id);
    return this.docs.getDocument(project, id);
  }

  @Post('ai-adjust')
  async aiAdjust(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AiAdjustDto,
  ) {
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.docs.aiAdjust(project, id, dto);
  }

  @Get('pdf')
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.expediente.renderDocumentPdf(await this.projects.findByIdForUser(projectId, user), id);
    const ascii = filename.replace(/[^A-Za-z0-9 ._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(buffer);
  }

  @Get('attachments')
  async attachments(@CurrentUser() user: AuthUser, @Param('projectId', ParseIntPipe) projectId: number, @Param('id', ParseIntPipe) id: number) {
    return this.docs.listAttachments(await this.projects.findByIdForUser(projectId, user), id);
  }

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async addAttachment(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { sectionKey?: string; place?: string; caption?: string },
  ) {
    if (!file) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Falta la imagen en el campo «file».' });
    const project = await this.projects.findByIdForUser(projectId, user);
    return this.docs.addAttachment(
      project,
      id,
      { sectionKey: String(body?.sectionKey ?? ''), place: body?.place, caption: body?.caption ?? null },
      { buffer: file.buffer },
      user.id,
    );
  }

  @Patch('attachments/:attachmentId')
  async updateAttachment(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Body() dto: UpdateAttachmentDto,
  ) {
    return this.docs.updateAttachment(await this.projects.findByIdForUser(projectId, user), id, attachmentId, dto);
  }

  @Delete('attachments/:attachmentId')
  async removeAttachment(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
  ) {
    await this.docs.removeAttachment(await this.projects.findByIdForUser(projectId, user), id, attachmentId);
    return { ok: true };
  }

  @Get('attachments/:attachmentId/image')
  async image(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res() res: Response,
  ): Promise<void> {
    const { image, mime } = await this.docs.attachmentImage(await this.projects.findByIdForUser(projectId, user), id, attachmentId);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(image.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(image);
  }
}

/** Plantillas de entregables: Kubo y por cliente. Cambiarlas es de quien dirige proyectos. */
@Controller('deliverable-templates')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class DeliverableTemplatesController {
  constructor(private readonly docs: DeliverableDocumentService) {}

  @Get()
  list() {
    return this.docs.listTemplates();
  }

  @Get(':type')
  get(@Param('type') type: string, @Query('clientId') clientId?: string) {
    return this.docs.getTemplate(type.toUpperCase(), clientId ? Number(clientId) || null : null);
  }

  @Put(':type')
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  save(@CurrentUser() user: AuthUser, @Param('type') type: string, @Body() dto: SaveTemplateDto) {
    const clientId = dto.clientId == null ? null : Number(dto.clientId) || null;
    return this.docs.saveTemplate(type.toUpperCase(), clientId, dto.name, dto.sections, user.id);
  }

  @Delete(':type')
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  async remove(@Param('type') type: string, @Query('clientId') clientId?: string) {
    await this.docs.removeTemplate(type.toUpperCase(), clientId ? Number(clientId) || null : null);
    return { ok: true };
  }
}
