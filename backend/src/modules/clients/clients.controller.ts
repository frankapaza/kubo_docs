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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientStatus } from './entities/client.entity';

@Controller('clients')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  list(@Query('status') status?: ClientStatus, @Query('q') q?: string) {
    return this.service.list({ status, q });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findByIdOrFail(id);
  }

  @Post()
  @Roles('ADMIN', 'PRODUCT_OWNER')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateClientDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PRODUCT_OWNER')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClientDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
