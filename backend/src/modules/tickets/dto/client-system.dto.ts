import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateClientSystemDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;
}

export class UpdateClientSystemDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
