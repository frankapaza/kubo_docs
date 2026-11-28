import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { MeetingNotesService } from './meeting-notes.service';

export class CreateMeetingNoteDto {
  @Type(() => Number) @IsInt() @Min(0)
  offsetSec!: number;

  @IsIn(['NOTA', 'ACUERDO', 'TAREA'])
  kind!: 'NOTA' | 'ACUERDO' | 'TAREA';

  @IsString() @MaxLength(2000)
  text!: string;
}

/** Notas de la reunión tomadas durante la grabación (iPad). */
@Controller()
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class MeetingNotesController {
  constructor(private readonly notes: MeetingNotesService) {}

  @Get('meetings/:id/notes')
  list(@Param('id', ParseIntPipe) id: number) {
    return this.notes.list(id);
  }

  @Post('meetings/:id/notes')
  @HttpCode(201)
  create(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateMeetingNoteDto, @CurrentUser() user: AuthUser) {
    return this.notes.create(id, dto, user.id);
  }

  @Delete('meeting-notes/:noteId')
  @HttpCode(204)
  async remove(@Param('noteId', ParseIntPipe) noteId: number) {
    await this.notes.remove(noteId);
  }
}
