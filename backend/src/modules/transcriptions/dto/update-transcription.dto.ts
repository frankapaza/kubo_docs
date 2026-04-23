import { IsOptional, IsString } from 'class-validator';

export class UpdateTranscriptionDto {
  @IsOptional()
  @IsString()
  contentText?: string;
}
