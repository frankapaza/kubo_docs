import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { WorkItemConformityService } from './work-item-conformity.service';

export class CreateConformityDto {
  @IsString() @Length(2, 180)
  signerName!: string;

  @IsEmail({}, { message: 'El correo del firmante no es válido.' }) @MaxLength(180)
  signerEmail!: string;

  @IsOptional() @IsString() @MaxLength(40)
  signerDocumentNumber?: string;

  @IsOptional() @IsString() @MaxLength(180)
  signerRole?: string;

  @IsOptional() @IsString() @MaxLength(5_000)
  observaciones?: string;
}

/** Acta de conformidad de un requerimiento: generar y enviar a firma, reenviar, anular. Solo el equipo. */
@Controller('work-items/:id/conformity')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class WorkItemConformityController {
  constructor(private readonly conformity: WorkItemConformityService) {}

  @Get()
  async get(@Param('id', ParseIntPipe) id: number) {
    return { acta: await this.conformity.get(id) };
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CreateConformityDto) {
    return this.conformity.create(id, user.id, dto);
  }

  @Post('resend')
  resend(@Param('id', ParseIntPipe) id: number) {
    return this.conformity.resend(id);
  }

  @Delete()
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.conformity.cancel(id, user.id);
    return { ok: true };
  }
}
