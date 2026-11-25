import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AvailabilityAgentService } from './availability-agent.service';
import { AvailabilityImportService } from './availability-import.service';
import { ImportCsvDto } from './dto/import.dto';
import { AvailabilityInventoryService } from './availability-inventory.service';
import { CreateServerDto, CreateServiceDto, TestServiceDto, UpdateServerDto, UpdateServiceDto } from './dto/inventory.dto';

@Controller('availability')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class AvailabilityInventoryController {
  constructor(
    private readonly inventory: AvailabilityInventoryService,
    private readonly agent: AvailabilityAgentService,
    private readonly importer: AvailabilityImportService,
  ) {}

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

  /** Estado del agente del servidor: última muestra, discos con tendencia y series de 24 h. */
  @Get('servers/:id/agent')
  agentView(@Param('id', ParseIntPipe) id: number) {
    return this.agent.agentView(id, new Date());
  }

  /** Devuelve `{ token, installScript }`: el token se muestra una sola vez. */
  @Roles('ADMIN')
  @Post('servers/:id/agent-token')
  @HttpCode(201)
  issueAgentToken(@Param('id', ParseIntPipe) id: number) {
    return this.inventory.issueAgentToken(id);
  }

  @Roles('ADMIN')
  @Delete('servers/:id/agent-token')
  @HttpCode(204)
  async revokeAgentToken(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.inventory.revokeAgentToken(id);
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

  /** Vista previa de la importación CSV: no escribe nada. */
  @Roles('ADMIN')
  @Post('import/preview')
  @HttpCode(200)
  importPreview(@Body() dto: ImportCsvDto) {
    return this.importer.preview(dto.csv);
  }

  /** Vuelve a validar y crea las filas nuevas en una sola transacción. */
  @Roles('ADMIN')
  @Post('import/commit')
  @HttpCode(200)
  importCommit(@Body() dto: ImportCsvDto) {
    return this.importer.commit(dto.csv);
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
