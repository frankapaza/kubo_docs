import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { ErrorListQueryDto } from './dto/error-group.dto';
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
  constructor(private readonly service: ErrorGroupsService) {}

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
}
