import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSystemDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;
}

export class UpdateSystemDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  /** `false` retira el sistema del catálogo; `true` lo vuelve a ofrecer. */
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
