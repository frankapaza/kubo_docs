import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { AGENT_LEVELS, SERVICE_CATEGORIES, AgentLevel, ServiceCategory } from '../entities/ticket.entity';

export class CreateSupportAgentDto {
  @IsInt() @Min(1)
  userId!: number;

  @IsIn(AGENT_LEVELS)
  level!: AgentLevel;

  @IsOptional() @IsArray() @ArrayUnique() @IsIn(SERVICE_CATEGORIES, { each: true })
  specialties?: ServiceCategory[];
}

export class UpdateSupportAgentDto {
  @IsOptional() @IsIn(AGENT_LEVELS) level?: AgentLevel;

  @IsOptional() @IsArray() @ArrayUnique() @IsIn(SERVICE_CATEGORIES, { each: true })
  specialties?: ServiceCategory[];

  @IsOptional() @IsBoolean() isActive?: boolean;
}
