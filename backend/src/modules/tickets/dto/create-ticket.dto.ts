import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  TICKET_ORIGINS,
  TICKET_REQUEST_TYPES,
  SERVICE_CATEGORIES,
  TicketOrigin,
  TicketRequestType,
  ServiceCategory,
} from '../entities/ticket.entity';
import { TICKET_IMPACTS, TICKET_URGENCIES, TicketImpact, TicketUrgency } from '../domain/ticket-priority';

export class CreateTicketDto {
  @IsString()
  @MinLength(1)
  rawText!: string;

  @IsOptional() @IsString() @MaxLength(240)
  subject?: string;

  @IsOptional() @IsIn(TICKET_ORIGINS)
  origin?: TicketOrigin;

  @IsOptional() @IsIn(TICKET_REQUEST_TYPES)
  requestType?: TicketRequestType;

  @IsOptional() @IsIn(SERVICE_CATEGORIES)
  serviceCategory?: ServiceCategory;

  @IsOptional() @IsIn(TICKET_IMPACTS)
  impact?: TicketImpact;

  @IsOptional() @IsIn(TICKET_URGENCIES)
  urgency?: TicketUrgency;

  @IsOptional() @IsInt() @Min(1) clientId?: number;
  @IsOptional() @IsInt() @Min(1) projectId?: number;
  @IsOptional() @IsInt() @Min(1) systemId?: number;
  @IsOptional() @IsInt() @Min(1) meetingId?: number;

  @IsOptional() @IsDateString() capturedAt?: string;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsInt() @Min(0) durationMinutes?: number;

  @IsOptional() @IsString() @MaxLength(255) rawAudioFilename?: string;
  @IsOptional() @IsArray() labels?: string[];
}
