import { IsOptional, IsNumber, IsString, Length, ValidateIf } from 'class-validator';

export class UpdateJiraConfigDto {
  @ValidateIf((o) => o.jiraIntegrationId !== null)
  @IsOptional()
  @IsNumber()
  jiraIntegrationId!: number | null;

  @ValidateIf((o) => o.jiraProjectKey !== null)
  @IsOptional()
  @IsString()
  @Length(1, 20)
  jiraProjectKey!: string | null;
}
