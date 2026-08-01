import { IsInt, IsOptional, Min } from 'class-validator';

export class AssignWorkItemDto {
  /** null desasigna. */
  @IsOptional() @IsInt() @Min(1)
  assigneeUserId?: number | null;
}
