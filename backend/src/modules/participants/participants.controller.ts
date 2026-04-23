import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ParticipantsService } from './participants.service';
import { CreateParticipantDto } from './dto/create-participant.dto';
import { UpdateParticipantDto } from './dto/update-participant.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class ParticipantsController {
  constructor(private readonly service: ParticipantsService) {}

  @Get('meetings/:meetingId/participants')
  list(@Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.service.listByMeeting(meetingId);
  }

  @Post('meetings/:meetingId/participants')
  create(
    @Param('meetingId', ParseIntPipe) meetingId: number,
    @Body() dto: CreateParticipantDto,
  ) {
    return this.service.create(meetingId, dto);
  }

  @Patch('participants/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateParticipantDto) {
    return this.service.update(id, dto);
  }

  @Delete('participants/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
