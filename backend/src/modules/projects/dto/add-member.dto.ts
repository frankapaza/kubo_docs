import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ProjectRole } from '../entities/project-member.entity';

export class AddMemberDto {
  @IsInt()
  @Min(1)
  userId!: number;

  @IsOptional()
  @IsEnum(['OWNER', 'EDITOR', 'VIEWER'])
  roleInProject?: ProjectRole;
}
