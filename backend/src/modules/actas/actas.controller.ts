import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ActasService } from './actas.service';
import { ActaSignaturesService } from './services/acta-signatures.service';
import { UpdateActaDto } from './dto/update-acta.dto';
import { SignActaDto } from './dto/sign-acta.dto';
import { ExportToJiraDto } from '../integrations/dto/export-jira.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActasController {
  constructor(
    private readonly service: ActasService,
    private readonly signatures: ActaSignaturesService,
  ) {}

  @Post('meetings/:meetingId/acta/generate')
  @HttpCode(200)
  generate(@Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.service.generateFromMeeting(meetingId);
  }

  @Get('meetings/:meetingId/acta')
  getByMeeting(@Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.service.findByMeeting(meetingId);
  }

  @Get('actas/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findByIdOrFail(id);
  }

  @Patch('actas/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateActaDto) {
    return this.service.update(id, dto);
  }

  @Post('actas/:id/submit-review')
  @HttpCode(200)
  submit(@Param('id', ParseIntPipe) id: number) {
    return this.service.submitReview(id);
  }

  @Post('actas/:id/regenerate')
  @HttpCode(200)
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  regenerate(@Param('id', ParseIntPipe) id: number) {
    return this.service.regenerateFromAI(id);
  }

  @Post('actas/:id/backlog')
  @HttpCode(200)
  generateBacklog(@Param('id', ParseIntPipe) id: number) {
    return this.service.generateBacklog(id);
  }

  @Post('actas/:id/backlog/export/jira')
  @HttpCode(200)
  exportToJira(@Param('id', ParseIntPipe) id: number, @Body() dto: ExportToJiraDto) {
    return this.service.exportToJira(id, dto.integrationId, dto.projectKey, dto.backlog);
  }

  @Post('actas/:id/approve')
  @HttpCode(200)
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Get('actas/:id/pdf')
  async downloadPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const buffer = await this.service.getPdfBuffer(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="acta_${id}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Get('actas/:id/signatures')
  listSignatures(@Param('id', ParseIntPipe) id: number) {
    return this.signatures.listByActa(id);
  }

  @Post('actas/:id/signatures')
  @HttpCode(201)
  sign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SignActaDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      null;
    return this.signatures.sign(id, dto.participantId, user, ip);
  }

  @Delete('actas/:id/signatures/:sigId')
  async revokeSignature(
    @Param('sigId', ParseIntPipe) sigId: number,
    @CurrentUser() user: AuthUser,
  ): Promise<{ ok: true }> {
    await this.signatures.revoke(sigId, user);
    return { ok: true };
  }
}
