import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateMeetingDto } from './create-meeting.dto';
import { MEETING_STATUSES, MeetingStatus } from '../entities/meeting.entity';

export class UpdateMeetingDto extends PartialType(CreateMeetingDto) {
  @IsOptional()
  @IsEnum(MEETING_STATUSES)
  status?: MeetingStatus;
}
