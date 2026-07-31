import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupportAgentsService } from './support-agents.service';
import { CreateSupportAgentDto, UpdateSupportAgentDto } from './dto/support-agent.dto';

@Controller('support-agents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupportAgentsController {
  constructor(private readonly service: SupportAgentsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateSupportAgentDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupportAgentDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
