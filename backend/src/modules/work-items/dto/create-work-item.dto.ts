import {
  IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength,
} from 'class-validator';
import { WORK_ITEM_PRIORITIES, WorkItemPriority } from '../domain/work-item-board';

export class CreateWorkItemDto {
  @IsInt() @Min(1)
  clientId!: number;

  @IsOptional() @IsInt() @Min(1)
  projectId?: number;

  @IsString() @MinLength(1) @MaxLength(240)
  title!: string;

  @IsOptional() @IsString()
  descriptionMd?: string;

  @IsOptional() @IsArray()
  acceptanceCriteria?: string[];

  @IsOptional() @IsArray()
  labels?: string[];

  @IsOptional() @IsIn(WORK_ITEM_PRIORITIES)
  priority?: WorkItemPriority;

  @IsOptional() @IsInt() @Min(1)
  assigneeUserId?: number;

  /** Objetivo del equipo, no un SLA. Formato YYYY-MM-DD. */
  @IsOptional() @IsDateString()
  dueDate?: string;
}
