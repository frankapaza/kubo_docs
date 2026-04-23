import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class JiraReportDto {
  @IsInt()
  @Min(1)
  projectId!: number;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export class GenerateJiraReportDocDto extends JiraReportDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  clientId?: number;
}

export class JiraSourceDto {
  @IsInt()
  @Min(1)
  integrationId!: number;

  @IsString()
  @Length(1, 20)
  projectKey!: string;
}

export class MultiJiraReportDto {
  @IsInt()
  @Min(1)
  clientId!: number;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => JiraSourceDto)
  sources!: JiraSourceDto[];

  @IsOptional()
  @IsString()
  @Length(2, 250)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  additionalContext?: string;
}
