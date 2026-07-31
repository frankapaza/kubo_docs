import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  TICKET_IMPACTS,
  TICKET_URGENCIES,
  TICKET_PRIORITIES,
  TicketImpact,
  TicketUrgency,
  TicketPriority,
} from '../domain/ticket-priority';

export class OverridePriorityDto {
  @IsOptional() @IsIn(TICKET_IMPACTS) impact?: TicketImpact;
  @IsOptional() @IsIn(TICKET_URGENCIES) urgency?: TicketUrgency;

  /** Si viene, fija la prioridad a mano y marca priority_overridden. */
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;

  @IsString() @MinLength(3) @MaxLength(2000)
  reason!: string;
}
