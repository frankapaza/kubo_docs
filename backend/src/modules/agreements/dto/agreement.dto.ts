import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateAgreementDto {
  @IsString()
  @Length(3, 2000)
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}

export class UpdateAgreementDto {
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}
