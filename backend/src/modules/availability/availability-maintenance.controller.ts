import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AvailabilityMaintenanceService } from './availability-maintenance.service';
import { CreateMaintenanceDto } from './dto/maintenance.dto';

@Controller('availability')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class AvailabilityMaintenanceController {
  constructor(private readonly maintenance: AvailabilityMaintenanceService) {}

  @Get('maintenance')
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.maintenance.list({ from, to });
  }

  @Roles('ADMIN')
  @Post('maintenance')
  create(@Body() dto: CreateMaintenanceDto, @CurrentUser() user: AuthUser) {
    return this.maintenance.create(dto, user.id);
  }

  @Roles('ADMIN')
  @Post('maintenance/:id/end')
  @HttpCode(200)
  end(@Param('id', ParseIntPipe) id: number) {
    return this.maintenance.end(id);
  }

  @Roles('ADMIN')
  @Delete('maintenance/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.maintenance.remove(id);
  }
}
