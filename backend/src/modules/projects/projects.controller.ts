import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateJiraConfigDto } from './dto/jira-config.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ProjectStatus } from './entities/project.entity';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: ProjectStatus,
    @Query('clientId') clientId?: number,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.service.listForUser(user, {
      status,
      clientId: clientId ? Number(clientId) : undefined,
      page,
      pageSize,
    });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.findByIdForUser(id, user);
  }

  @Post()
  @Roles('ADMIN', 'PRODUCT_OWNER')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PRODUCT_OWNER')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/jira-config')
  @Roles('ADMIN', 'PRODUCT_OWNER')
  updateJiraConfig(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateJiraConfigDto) {
    return this.service.updateJiraConfig(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
