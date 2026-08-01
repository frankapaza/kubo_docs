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
  Query,
  UseGuards,
} from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { MeetingStatus } from './entities/meeting.entity';

@Controller('meetings')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: number,
    @Query('status') status?: MeetingStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.service.listForUser(user, { projectId, status, from, to, page, pageSize });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.findByIdForUser(id, user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMeetingDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMeetingDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/start')
  @HttpCode(200)
  start(@Param('id', ParseIntPipe) id: number) {
    return this.service.start(id);
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@Param('id', ParseIntPipe) id: number) {
    return this.service.end(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
