import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UserResponseDto } from './dto/user-response.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('me')
  async me(@CurrentUser() auth: AuthUser): Promise<UserResponseDto> {
    const u = await this.service.findByIdOrFail(auth.id);
    return UserResponseDto.from(u);
  }

  @Get()
  @Roles('ADMIN', 'PRODUCT_OWNER', 'SCRUM_MASTER')
  list(): Promise<UserResponseDto[]> {
    return this.service.listAll();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.service.create(dto);
  }

  @Patch(':id/role')
  @Roles('ADMIN')
  async updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() auth: AuthUser,
  ): Promise<UserResponseDto> {
    if (auth.id === id && dto.role !== 'ADMIN') {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Un ADMIN no puede quitarse a sí mismo el rol de ADMIN',
      });
    }
    return this.service.updateRole(id, dto.role);
  }
}
