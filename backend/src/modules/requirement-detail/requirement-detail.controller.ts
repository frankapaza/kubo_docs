import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RequirementDetailService } from './requirement-detail.service';

export class RequestDetailDto {
  @IsString() @MinLength(3, { message: 'Escribe qué falta (al menos 3 caracteres).' }) @MaxLength(5_000)
  message!: string;
}

/** Pedir más detalle al cliente y redactar la Especificación con IA. Solo el equipo. */
@Controller('work-items/:id')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class RequirementDetailController {
  constructor(private readonly detail: RequirementDetailService) {}

  @Post('request-detail')
  requestDetail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RequestDetailDto) {
    return this.detail.requestDetail(id, user.id, dto.message);
  }

  @Post('spec-draft')
  draftSpec(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.detail.draftSpec(id, user.id);
  }
}
