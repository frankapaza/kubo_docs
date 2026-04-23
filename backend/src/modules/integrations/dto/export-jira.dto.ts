import { IsNumber, IsObject, IsString, Length } from 'class-validator';
import { BacklogResult } from '../../ai/llm.types';

export class ExportToJiraDto {
  @IsNumber()
  integrationId!: number;

  @IsString()
  @Length(1, 20)
  projectKey!: string;

  @IsObject()
  backlog!: BacklogResult;
}
