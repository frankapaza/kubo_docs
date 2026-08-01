import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { WORK_ITEM_STATUSES, WorkItemStatus } from '../domain/work-item-board';

export class MoveWorkItemDto {
  @IsIn(WORK_ITEM_STATUSES)
  toStatus!: WorkItemStatus;

  @IsInt() @Min(0)
  toIndex!: number;

  /** Obligatorio cuando toStatus es BLOQUEADO o CANCELADO. */
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}
