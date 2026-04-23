import { IsEnum, IsNumber, IsOptional, IsString, Length } from 'class-validator';
import { SignatoryKind } from '../entities/document-signatory.entity';

export class CreateSignatoryDto {
  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsEnum(['INTERNAL', 'EXTERNAL'])
  kind!: SignatoryKind;

  @IsString()
  @Length(2, 180)
  fullName!: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  documentNumber?: string;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  role?: string;
}
