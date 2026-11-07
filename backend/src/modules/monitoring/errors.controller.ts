import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { CreateTicketFromErrorDto, ErrorListQueryDto, ResolveErrorDto } from './dto/error-group.dto';
import { ErrorActionsService } from './error-actions.service';
import { ErrorGroupsService } from './error-groups.service';

/**
 * Errores agrupados: los lee todo el personal, sin rol. Atender errores es
 * trabajo de la mesa, no solo de administración (las claves sí lo son).
 *
 * `summary` va antes de `:id` para que Nest no intente leer «summary» como id.
 */
@Controller('monitoring/errors')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class ErrorsController {
  constructor(
    private readonly service: ErrorGroupsService,
    private readonly actions: ErrorActionsService,
  ) {}

  @Get()
  list(@Query() q: ErrorListQueryDto) {
    return this.service.list(q);
  }

  @Get('summary')
  summary() {
    return this.service.summary();
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  @Post(':id/ticket')
  createTicket(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CreateTicketFromErrorDto) {
    return this.actions.createTicket(id, user.id, dto);
  }

  @Post(':id/resolve')
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ResolveErrorDto) {
    return this.actions.resolve(id, user.id, dto.note);
  }

  @Post(':id/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.actions.reopen(id, user.id);
  }
}
