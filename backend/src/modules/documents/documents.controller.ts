import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { UpsertTemplateDto } from './dto/upsert-template.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { SendDocumentEmailDto } from './dto/send-email.dto';
import { CommercialDocumentStatus } from './entities/commercial-document.entity';

@Controller()
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(private readonly service: DocumentsService) {}

  // ===================== TEMPLATES =====================

  @Get('document-templates')
  listTemplates(@Query('all') all?: string) {
    return this.service.listTemplates(all !== 'true');
  }

  @Get('document-templates/:id')
  findTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.service.findTemplateOrFail(id);
  }

  @Post('document-templates')
  @Roles('ADMIN', 'PRODUCT_OWNER')
  createTemplate(@CurrentUser() user: AuthUser, @Body() dto: UpsertTemplateDto) {
    return this.service.createTemplate(user.id, dto);
  }

  @Patch('document-templates/:id')
  @Roles('ADMIN', 'PRODUCT_OWNER')
  updateTemplate(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertTemplateDto) {
    return this.service.updateTemplate(id, dto);
  }

  @Delete('document-templates/:id')
  @Roles('ADMIN')
  async removeTemplate(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.removeTemplate(id);
    return { ok: true };
  }

  // ===================== DOCUMENTS =====================

  @Get('commercial-documents')
  listDocuments(
    @Query('clientId') clientId?: string,
    @Query('status') status?: CommercialDocumentStatus,
  ) {
    return this.service.listDocuments({
      clientId: clientId ? Number(clientId) : undefined,
      status,
    });
  }

  @Get('commercial-documents/:id')
  findDocument(@Param('id', ParseIntPipe) id: number) {
    return this.service.findDocumentOrFail(id);
  }

  @Post('commercial-documents')
  @HttpCode(201)
  createDocument(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDocumentDto,
    @Req() req: Request,
  ) {
    this.logger.log(`RAW body: ${JSON.stringify(req.body)}`);
    this.logger.log(`DTO after validation: ${JSON.stringify(dto)}`);
    return this.service.createDocument(user.id, dto);
  }

  @Patch('commercial-documents/:id')
  updateDocument(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDocumentDto) {
    return this.service.updateDocument(id, dto);
  }

  @Delete('commercial-documents/:id')
  async removeDocument(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.removeDocument(id);
    return { ok: true };
  }

  @Get('commercial-documents/:id/pdf')
  async downloadPdf(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.service.getPdfBuffer(id);
    const doc = await this.service.findDocumentOrFail(id);
    const safeTitle = doc.title.replace(/[^a-z0-9áéíóúñ\s-]/gi, '').trim().slice(0, 80) || `documento-${id}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeTitle}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Post('commercial-documents/:id/send-email')
  @HttpCode(200)
  async sendEmail(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendDocumentEmailDto,
  ): Promise<{ messageId: string }> {
    return this.service.sendByEmail(id, dto);
  }
}
