import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { AGENT_LEVELS, AgentLevel } from '../entities/ticket.entity';

export class EscalateTicketDto {
  @IsIn(AGENT_LEVELS)
  toLevel!: AgentLevel;

  /** Regla 03: derivar sin motivo no se acepta. */
  @IsString() @MinLength(3) @MaxLength(2000)
  reason!: string;

  @IsOptional() @IsInt() @Min(1)
  assigneeUserId?: number;
}
