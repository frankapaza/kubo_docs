import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProjectMembersService } from './project-members.service';
import { AddMemberDto } from './dto/add-member.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('projects/:projectId/members')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class ProjectMembersController {
  constructor(private readonly service: ProjectMembersService) {}

  @Get()
  list(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.service.listByProject(projectId);
  }

  @Post()
  @Roles('ADMIN', 'PRODUCT_OWNER')
  add(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: AddMemberDto,
  ) {
    return this.service.add(projectId, dto.userId, dto.roleInProject ?? 'VIEWER');
  }

  @Delete(':userId')
  @Roles('ADMIN', 'PRODUCT_OWNER')
  async remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ ok: true }> {
    await this.service.remove(projectId, userId);
    return { ok: true };
  }
}
