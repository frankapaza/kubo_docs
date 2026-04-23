import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AIProviderKind } from '../entities/ai-provider.entity';

export class CreateAIProviderDto {
  @IsEnum(['OPENAI', 'DEEPSEEK', 'GEMINI', 'GROQ'])
  provider!: AIProviderKind;

  @IsString()
  @Length(1, 100)
  label!: string;

  @IsString()
  @Length(1, 100)
  model!: string;

  @IsString()
  @Length(8, 500)
  apiKey!: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  baseUrl?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
