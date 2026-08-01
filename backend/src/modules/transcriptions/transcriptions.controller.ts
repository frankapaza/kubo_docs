import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TranscriptionsService } from './transcriptions.service';
import { UpdateTranscriptionDto } from './dto/update-transcription.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';

@Controller()
@UseGuards(JwtAuthGuard, StaffOnlyGuard)
export class TranscriptionsController {
  constructor(private readonly service: TranscriptionsService) {}

  @Get('transcriptions/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findByIdOrFail(id);
  }

  @Get('meetings/:meetingId/transcription')
  findByMeeting(@Param('meetingId', ParseIntPipe) meetingId: number) {
    return this.service.findByMeeting(meetingId);
  }

  @Patch('transcriptions/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTranscriptionDto) {
    return this.service.update(id, dto);
  }

  @Post('transcriptions/:id/retry')
  @HttpCode(200)
  retry(@Param('id', ParseIntPipe) id: number) {
    return this.service.retry(id);
  }
}
