import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ClientSystemsService } from './client-systems.service';
import { AssignClientSystemDto, UpdateClientSystemDto } from './dto/client-system.dto';

/**
 * Los sistemas del catálogo asignados a un cliente.
 *
 * Escribir lleva `@Roles('ADMIN', 'PRODUCT_OWNER')`, la misma guarda que editar
 * la ficha del cliente: asignar un sistema es un hecho de la relación
 * comercial, del mismo peso. Antes no llevaba ninguna, y con texto libre por
 * cliente era un descuido de poco alcance; con un catálogo compartido, una
 * asignación equivocada se ve en el informe del cliente.
 *
 * Leer sigue abierto a todo el personal: el formulario de ticket y la ficha del
 * ticket necesitan la lista.
 */
@Controller('clients/:clientId/systems')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class ClientSystemsController {
  constructor(private readonly service: ClientSystemsService) {}

  @Get()
  list(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.service.listByClient(clientId);
  }

  @Post()
  @Roles('ADMIN', 'PRODUCT_OWNER')
  create(@Param('clientId', ParseIntPipe) clientId: number, @Body() dto: AssignClientSystemDto) {
    return this.service.create(clientId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PRODUCT_OWNER')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClientSystemDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PRODUCT_OWNER')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
