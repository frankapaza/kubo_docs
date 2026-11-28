import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Response } from 'express';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { ActaAnnexesService, MAX_ANNEX_IMAGE_BYTES } from './services/acta-annexes.service';

export class AnnexFieldsDto {
  @IsOptional() @IsString() @MaxLength(4000)
  caption?: string;

  @IsOptional() @IsString() @MaxLength(40)
  section?: string;

  @IsOptional() @IsIn(['ANEXO', 'INLINE'])
  place?: 'ANEXO' | 'INLINE';
}

export class UpdateAnnexDto extends AnnexFieldsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  position?: number;
}

/** Evidencias del acta: foto y/o texto, como anexos al final o en su sección. */
@Controller()
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class ActaAnnexesController {
  constructor(private readonly annexes: ActaAnnexesService) {}

  @Get('actas/:id/annexes')
  list(@Param('id', ParseIntPipe) id: number) {
    return this.annexes.list(id);
  }

  /** multipart/form-data: `file` (opcional, JPEG/PNG ≤ 5 MB) y `caption`, `section`, `place`. */
  @Post('actas/:id/annexes')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ANNEX_IMAGE_BYTES + 1 } }))
  create(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: AnnexFieldsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.annexes.create(id, dto, file ? { buffer: file.buffer, mimetype: file.mimetype } : null, user);
  }

  @Patch('acta-annexes/:annexId')
  update(@Param('annexId', ParseIntPipe) annexId: number, @Body() dto: UpdateAnnexDto) {
    return this.annexes.update(annexId, dto);
  }

  @Delete('acta-annexes/:annexId')
  @HttpCode(204)
  async remove(@Param('annexId', ParseIntPipe) annexId: number) {
    await this.annexes.remove(annexId);
  }

  @Get('acta-annexes/:annexId/image')
  async image(@Param('annexId', ParseIntPipe) annexId: number, @Res() res: Response) {
    const img = await this.annexes.image(annexId);
    if (!img) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Esta evidencia no tiene foto' });
      return;
    }
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(img.image);
  }
}
