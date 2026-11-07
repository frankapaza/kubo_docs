import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SystemsService } from './systems.service';
import { CreateSystemDto, UpdateSystemDto } from './dto/system.dto';

/**
 * El catálogo de sistemas. Escribir en él es solo de `ADMIN`: es una lista
 * global de la casa --como proveedores de IA, integraciones y plantillas de
 * aviso, que llevan todas `@Roles('ADMIN')`-- y una fila mal puesta la heredan
 * todos los clientes.
 *
 * Leer, en cambio, lo necesita todo el personal: la pestaña «Sistemas» de
 * cualquier ficha de cliente pinta su desplegable con esta lista.
 */
@Controller('systems')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class SystemsController {
  constructor(private readonly service: SystemsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateSystemDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSystemDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
