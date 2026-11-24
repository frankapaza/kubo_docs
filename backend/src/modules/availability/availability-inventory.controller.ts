import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AvailabilityInventoryService } from './availability-inventory.service';
import { CreateServerDto, CreateServiceDto, TestServiceDto, UpdateServerDto, UpdateServiceDto } from './dto/inventory.dto';

@Controller('availability')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class AvailabilityInventoryController {
  constructor(private readonly inventory: AvailabilityInventoryService) {}

  @Get('servers')
  listServers() {
    return this.inventory.listServers();
  }

  @Roles('ADMIN')
  @Post('servers')
  createServer(@Body() dto: CreateServerDto) {
    return this.inventory.createServer(dto);
  }

  @Roles('ADMIN')
  @Patch('servers/:id')
  updateServer(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateServerDto, @CurrentUser() user: AuthUser) {
    return this.inventory.updateServer(id, dto, user.id);
  }

  @Get('services')
  listServices(@Query('serverId', new ParseIntPipe({ optional: true })) serverId?: number) {
    return this.inventory.listServices(serverId);
  }

  @Roles('ADMIN')
  @Post('services')
  createService(@Body() dto: CreateServiceDto) {
    return this.inventory.createService(dto);
  }

  @Roles('ADMIN')
  @Post('services/test')
  @HttpCode(200)
  testService(@Body() dto: TestServiceDto) {
    return this.inventory.testService(dto.serviceId);
  }

  @Roles('ADMIN')
  @Patch('services/:id')
  updateService(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateServiceDto, @CurrentUser() user: AuthUser) {
    return this.inventory.updateService(id, dto, user.id);
  }

  @Get('probes')
  listProbes() {
    return this.inventory.listProbes();
  }

  @Roles('ADMIN')
  @Post('probes/:id/token')
  @HttpCode(201)
  issueToken(@Param('id', ParseIntPipe) id: number) {
    return this.inventory.issueProbeToken(id);
  }

  @Roles('ADMIN')
  @Delete('probes/:id/token')
  @HttpCode(204)
  async revokeToken(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.inventory.revokeProbeToken(id);
  }
}
