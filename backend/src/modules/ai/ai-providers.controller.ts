import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AIProvidersService } from './ai-providers.service';
import { CreateAIProviderDto } from './dto/create-ai-provider.dto';
import { UpdateAIProviderDto } from './dto/update-ai-provider.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('ai/providers')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
@Roles('ADMIN')
export class AIProvidersController {
  constructor(private readonly service: AIProvidersService) {}

  @Get()
  list() {
    return this.service.listView();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAIProviderDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAIProviderDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.service.activate(id);
  }

  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id', ParseIntPipe) id: number) {
    return this.service.testConnection(id);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
