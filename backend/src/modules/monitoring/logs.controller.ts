import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { LogSearchQueryDto } from './dto/log-search.dto';
import { LogsService } from './logs.service';

/** Búsqueda de logs: lectura para todo el personal, sin rol. */
@Controller('monitoring/logs')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class LogsController {
  constructor(private readonly service: LogsService) {}

  @Get()
  search(@Query() q: LogSearchQueryDto) {
    return this.service.search(q);
  }
}
