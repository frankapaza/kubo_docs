import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class MonthlyAttentionReportDto {
  @IsInt()
  @Min(1)
  clientId!: number;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalContext?: string;
}
