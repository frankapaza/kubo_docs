import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TICKET_STATUSES, TicketStatus } from '../domain/ticket-state-machine';

export class TransitionTicketDto {
  @IsIn(TICKET_STATUSES)
  toStatus!: TicketStatus;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;

  @IsOptional() @IsString() @MinLength(1)
  resolutionMd?: string;

  @IsOptional() @IsString() @MinLength(1)
  rootCause?: string;

  @IsOptional() @IsString() @MinLength(1)
  correctiveAction?: string;
}
