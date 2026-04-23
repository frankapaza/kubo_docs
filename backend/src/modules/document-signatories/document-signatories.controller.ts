import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DocumentSignatoriesService } from './document-signatories.service';
import { CreateSignatoryDto } from './dto/create-signatory.dto';
import { UpdateSignatoryDto } from './dto/update-signatory.dto';

@Controller()
export class DocumentSignatoriesController {
  constructor(private readonly service: DocumentSignatoriesService) {}

  // ── Rutas protegidas ────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('documents/:documentId/signatories')
  list(@Param('documentId', ParseIntPipe) documentId: number) {
    return this.service.list(documentId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('documents/:documentId/signatories')
  create(
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body() dto: CreateSignatoryDto,
  ) {
    return this.service.create(documentId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('document-signatories/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSignatoryDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('document-signatories/:id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('document-signatories/:id/request-signature')
  requestSignature(@Param('id', ParseIntPipe) id: number) {
    return this.service.requestSignature(id);
  }

  // ── Rutas públicas (sin JWT) ────────────────────────────────────────────

  @Get('sign/:token')
  getByToken(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Post('sign/:token/confirm')
  confirmSignature(@Param('token') token: string, @Ip() ip: string) {
    return this.service.confirmSignature(token, ip);
  }
}
