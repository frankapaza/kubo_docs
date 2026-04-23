import { IsEnum, IsString, Length } from 'class-validator';
import { IntegrationProvider } from '../entities/integration.entity';

export class CreateIntegrationDto {
  @IsEnum(['JIRA'])
  provider!: IntegrationProvider;

  @IsString()
  @Length(1, 100)
  label!: string;

  @IsString()
  @Length(1, 255)
  workspaceUrl!: string;

  @IsString()
  @Length(1, 255)
  email!: string;

  @IsString()
  @Length(8, 500)
  apiToken!: string;
}
