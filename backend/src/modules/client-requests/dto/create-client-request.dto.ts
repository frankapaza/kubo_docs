import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CLIENT_REQUEST_SOURCES,
  ClientRequestSource,
  SERVICE_CATEGORIES,
  ServiceCategory,
} from '../entities/client-request.entity';

export class CreateClientRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(8000)
  rawText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  title?: string;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  @IsOptional()
  @IsDateString()
  attendedAt?: string;

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

  @IsOptional()
  @IsEnum(SERVICE_CATEGORIES)
  serviceCategory?: ServiceCategory;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  durationMinutes?: number;
}
