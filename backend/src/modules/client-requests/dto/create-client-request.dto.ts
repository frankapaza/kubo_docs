import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { CLIENT_REQUEST_SOURCES, ClientRequestSource } from '../entities/client-request.entity';

export class CreateClientRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(8000)
  rawText!: string;

  @IsOptional()
  @IsEnum(CLIENT_REQUEST_SOURCES)
  source?: ClientRequestSource;

  @IsOptional()
  @IsInt()
  @Min(1)
  clientId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  projectId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  meetingId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  rawAudioFilename?: string;
}
