import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceService } from './workspace.service';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace.dto';

@Controller('workspace-settings')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Patch()
  @Roles('ADMIN')
  update(@Body() dto: UpdateWorkspaceSettingsDto) {
    return this.service.update(dto);
  }
}
