import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { WorkItemsService } from './work-items.service';
import { WorkItemBoardService } from './work-item-board.service';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { MoveWorkItemDto } from './dto/move-work-item.dto';
import { AssignWorkItemDto } from './dto/assign-work-item.dto';
import { ChangePriorityDto } from './dto/change-priority.dto';
import { DueFilter } from './work-items.repository';
import { WorkItemStatus, WorkItemPriority } from './domain/work-item-board';

@Controller('work-items')
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class WorkItemsController {
  constructor(
    private readonly service: WorkItemsService,
    private readonly board: WorkItemBoardService,
  ) {}

  @Get()
  list(
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: WorkItemStatus,
    @Query('priority') priority?: WorkItemPriority,
    @Query('assigneeId') assigneeId?: string,
    @Query('dueFilter') dueFilter?: DueFilter,
    @Query('q') q?: string,
  ) {
    return this.service.list({
      clientId: clientId ? Number(clientId) : undefined,
      projectId: projectId ? Number(projectId) : undefined,
      status,
      priority,
      assigneeUserId: assigneeId ? Number(assigneeId) : undefined,
      dueFilter,
      q,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findWithTimeline(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkItemDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkItemDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }

  @Post(':id/move')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveWorkItemDto,
  ) {
    return this.board.move({
      workItemId: id,
      actorUserId: user.id,
      toStatus: dto.toStatus,
      toIndex: dto.toIndex,
      reason: dto.reason,
    });
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignWorkItemDto,
  ) {
    return this.board.assign({
      workItemId: id,
      actorUserId: user.id,
      assigneeUserId: dto.assigneeUserId ?? null,
    });
  }

  @Post(':id/priority')
  changePriority(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangePriorityDto,
  ) {
    return this.board.changePriority({
      workItemId: id,
      actorUserId: user.id,
      priority: dto.priority,
      reason: dto.reason,
    });
  }
}
