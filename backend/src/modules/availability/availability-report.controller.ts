import { BadRequestException, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AvailabilityReportService } from './availability-report.service';

/** Informe mensual de disponibilidad por cliente (solo personal). */
@Controller('availability')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class AvailabilityReportController {
  constructor(private readonly reports: AvailabilityReportService) {}

  @Get('reports')
  list(@Query('clientId') clientId?: string) {
    const id = Number(clientId);
    if (!clientId || !Number.isInteger(id) || id <= 0) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Indica el cliente (clientId)' });
    }
    return this.reports.list(id);
  }

  @Get('reports/:clientId/:month')
  get(@Param('clientId', ParseIntPipe) clientId: number, @Param('month') month: string) {
    return this.reports.get(clientId, month);
  }

  @Roles('ADMIN')
  @Post('reports/:clientId/:month/generate')
  @HttpCode(200)
  generate(@Param('clientId', ParseIntPipe) clientId: number, @Param('month') month: string, @CurrentUser() user: AuthUser) {
    return this.reports.generate(clientId, month, new Date(), user.id);
  }
}
