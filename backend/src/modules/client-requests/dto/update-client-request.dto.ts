import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CLIENT_REQUEST_PRIORITIES,
  CLIENT_REQUEST_STATUSES,
  CLIENT_REQUEST_TYPES,
  ClientRequestPriority,
  ClientRequestStatus,
  ClientRequestType,
  SERVICE_CATEGORIES,
  ServiceCategory,
} from '../entities/client-request.entity';

export class UpdateClientRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  rawText?: string;

  @IsOptional()
  @IsEnum(CLIENT_REQUEST_STATUSES)
  status?: ClientRequestStatus;

  @IsOptional()
  @IsEnum(CLIENT_REQUEST_TYPES)
  requestType?: ClientRequestType | null;

  @IsOptional()
  @IsEnum(CLIENT_REQUEST_PRIORITIES)
  priority?: ClientRequestPriority | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  clientId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  projectId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  assigneeUserId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  moduleName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  screenName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  flowContext?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(16000)
  descriptionMd?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acceptanceCriteria?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[] | null;

  @IsOptional()
  @IsEnum(SERVICE_CATEGORIES)
  serviceCategory?: ServiceCategory | null;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  durationMinutes?: number | null;
}
