import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Length(2, 30)
  code!: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  @Matches(/^[A-Z0-9]+$/, { message: 'jiraCode debe ser letras mayúsculas o números (ej. VTA)' })
  jiraCode?: string;

  @IsString()
  @Length(3, 180)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  clientId?: number;
}
