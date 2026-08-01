import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { WORK_ITEM_PRIORITIES, WorkItemPriority } from '../domain/work-item-board';

export class ChangePriorityDto {
  @IsIn(WORK_ITEM_PRIORITIES)
  priority!: WorkItemPriority;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}
