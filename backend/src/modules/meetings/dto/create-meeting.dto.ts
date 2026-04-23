import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { MEETING_TYPES, MeetingType } from '../entities/meeting.entity';

export class CreateMeetingDto {
  @IsInt()
  @Min(1)
  projectId!: number;

  @IsString()
  @Length(3, 200)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  @Length(1, 180)
  location?: string;

  @IsOptional()
  @IsEnum(MEETING_TYPES)
  meetingType?: MeetingType;
}
