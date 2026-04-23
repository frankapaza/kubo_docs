import { IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateAIProviderDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  model?: string;

  @IsOptional()
  @IsString()
  @Length(8, 500)
  apiKey?: string;

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
