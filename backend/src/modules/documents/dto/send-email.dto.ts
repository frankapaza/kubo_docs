import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class SendDocumentEmailDto {
  @IsEmail()
  to!: string;

  @IsOptional()
  @IsEmail()
  cc?: string;

  @IsOptional()
  @IsString()
  @Length(2, 250)
  subject?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  message?: string;
}
