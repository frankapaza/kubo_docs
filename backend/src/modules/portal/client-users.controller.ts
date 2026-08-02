import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ClientUsersService } from './client-users.service';
import { ClientUserView, CreateClientUserDto, UpdateClientUserDto } from './dto/client-user.dto';

/**
 * Superficie del panel interno para dar de alta y gestionar a los usuarios
 * del portal de las empresas cliente. Hasta esta tarea había que insertarlos
 * a mano en la base.
 */
@Controller('client-users')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class ClientUsersController {
  constructor(private readonly service: ClientUsersService) {}

  @Get()
  list(@Query('clientId', ParseIntPipe) clientId: number): Promise<ClientUserView[]> {
    return this.service.listByClient(clientId);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateClientUserDto,
  ): Promise<ClientUserView> {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClientUserDto,
  ): Promise<ClientUserView> {
    return this.service.update(id, dto);
  }
}
