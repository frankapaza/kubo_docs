import { IsOptional, IsString } from 'class-validator';

export class UpdateActaDto {
  @IsOptional()
  @IsString()
  contentMarkdown?: string;
}
