import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { ClientSystemsService } from './client-systems.service';
import { CreateClientSystemDto, UpdateClientSystemDto } from './dto/client-system.dto';

@Controller('clients/:clientId/systems')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class ClientSystemsController {
  constructor(private readonly service: ClientSystemsService) {}

  @Get()
  list(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.service.listByClient(clientId);
  }

  @Post()
  create(@Param('clientId', ParseIntPipe) clientId: number, @Body() dto: CreateClientSystemDto) {
    return this.service.create(clientId, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClientSystemDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
