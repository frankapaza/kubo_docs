import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreateParticipantDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  userId?: number;

  @IsString()
  @Length(2, 180)
  fullName!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  documentNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[+0-9 ()-]{6,30}$/, { message: 'El teléfono solo admite números, espacios, +, guiones y paréntesis (6 a 30).' })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  role?: string;

  @IsOptional()
  @IsBoolean()
  attended?: boolean;
}
