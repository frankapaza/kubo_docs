import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ConformityStatus, CONFORMITY_STATUSES } from '../entities/document-signatory.entity';

export class UpdateSignatoryDto {
  @IsOptional()
  @IsEnum(CONFORMITY_STATUSES)
  conformityStatus?: ConformityStatus;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  role?: string;
}
