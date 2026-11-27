import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseBoolPipe, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AvailabilityStateService } from './availability-state.service';
import { AddNoteDto } from './dto/state.dto';

/** Lectura y acciones operativas del personal: cualquier usuario del personal, sin exigir ADMIN. */
@Controller('availability')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class AvailabilityStateController {
  constructor(private readonly stateService: AvailabilityStateService) {}

  @Get('state')
  state(
    @Query('clientId', new ParseIntPipe({ optional: true })) clientId?: number,
    @Query('status') status?: string,
    @Query('serverId', new ParseIntPipe({ optional: true })) serverId?: number,
  ) {
    return this.stateService.state({ clientId, status, serverId });
  }

  @Get('state.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="estado-disponibilidad.csv"')
  stateCsv(
    @Query('clientId', new ParseIntPipe({ optional: true })) clientId?: number,
    @Query('status') status?: string,
    @Query('serverId', new ParseIntPipe({ optional: true })) serverId?: number,
  ) {
    return this.stateService.stateCsv({ clientId, status, serverId });
  }

  @Post('services/:id/check-now')
  @HttpCode(202)
  checkNow(@Param('id', ParseIntPipe) id: number) {
    return this.stateService.checkNow(id);
  }

  @Get('incidents')
  listIncidents(
    @Query('open', new ParseBoolPipe({ optional: true })) open?: boolean,
    @Query('clientId', new ParseIntPipe({ optional: true })) clientId?: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.stateService.listIncidents({ limit, open, clientId, from: parseDate(from, 'from'), to: parseDate(to, 'to') });
  }

  @Get('incidents/:id')
  incidentDetail(@Param('id', ParseIntPipe) id: number) {
    return this.stateService.incidentDetail(id);
  }

  @Post('incidents/:id/ack')
  @HttpCode(200)
  acknowledge(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.stateService.acknowledge(id, user.id);
  }

  @Post('incidents/:id/notes')
  addNote(@Param('id', ParseIntPipe) id: number, @Body() dto: AddNoteDto, @CurrentUser() user: AuthUser) {
    return this.stateService.addNote(id, dto.text, user.id);
  }
}

function parseDate(v: string | undefined, name: string): Date | undefined {
  if (v === undefined || v === '') return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: `Fecha inválida en "${name}"` });
  }
  return d;
}
