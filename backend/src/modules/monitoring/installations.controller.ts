import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { CreateInstallationDto, UpdateInstallationDto } from './dto/installation.dto';
import { InstallationsService } from './installations.service';

/**
 * Instalaciones de monitoreo y sus claves: solo `ADMIN`. Quien tiene una clave
 * puede escribir logs bajo la identidad de un cliente, así que emitirla,
 * regenerarla o revocarla no es cosa de todo el personal.
 *
 * `GET sources` es la excepción: los filtros de la pantalla de logs la
 * necesitan todos los que pueden leer logs, y no expone ninguna clave.
 */
@Controller('monitoring')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class InstallationsController {
  constructor(private readonly service: InstallationsService) {}

  @Get('installations')
  @Roles('ADMIN')
  list() {
    return this.service.list();
  }

  @Post('installations')
  @Roles('ADMIN')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInstallationDto) {
    return this.service.create(dto, user.id);
  }

  @Patch('installations/:id')
  @Roles('ADMIN')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInstallationDto) {
    return this.service.update(id, dto);
  }

  /** Regenerar: la clave anterior deja de valer en el acto. */
  @Post('installations/:id/key')
  @Roles('ADMIN')
  regenerate(@Param('id', ParseIntPipe) id: number) {
    return this.service.regenerateKey(id);
  }

  @Delete('installations/:id/key')
  @Roles('ADMIN')
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.service.revokeKey(id);
  }

  @Get('sources')
  sources() {
    return this.service.listSourceOptions();
  }
}
