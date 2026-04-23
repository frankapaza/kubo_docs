import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';

@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get()
  list() {
    return this.service.listView();
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIntegrationDto) {
    return this.service.create(user.id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }

  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id', ParseIntPipe) id: number) {
    return this.service.test(id);
  }

  @Get(':id/projects')
  listProjects(@Param('id', ParseIntPipe) id: number) {
    return this.service.listProjects(id);
  }
}
