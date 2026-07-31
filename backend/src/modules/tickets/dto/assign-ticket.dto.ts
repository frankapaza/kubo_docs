import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AssignTicketDto {
  @IsInt() @Min(1)
  assigneeUserId!: number;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}
