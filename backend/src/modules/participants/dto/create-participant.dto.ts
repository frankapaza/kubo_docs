import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

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
  @Length(1, 80)
  role?: string;

  @IsOptional()
  @IsBoolean()
  attended?: boolean;
}
