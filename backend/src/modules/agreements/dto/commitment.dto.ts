import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { CommitmentStatus } from '../entities/commitment.entity';

export class CreateCommitmentDto {
  @IsString()
  @Length(3, 2000)
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  assigneeUserId?: number;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  assigneeName?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class UpdateCommitmentDto {
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  assigneeUserId?: number;

  @IsOptional()
  @IsString()
  assigneeName?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(['OPEN', 'DONE', 'CANCELLED'])
  status?: CommitmentStatus;
}
