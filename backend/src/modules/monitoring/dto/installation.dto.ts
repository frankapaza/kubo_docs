import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { LOG_LEVELS, LogLevel } from '../domain/log-level';

export class CreateInstallationDto {
  @IsIn(['CLIENTE', 'INTERNA'])
  kind!: 'CLIENTE' | 'INTERNA';

  /** Solo CLIENTE: la asignación cliente-sistema a la que pertenece. */
  @IsOptional() @IsInt() @Min(1)
  clientSystemId?: number;

  /** Solo INTERNA: nombre del aplicativo propio. */
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  /** Solo INTERNA: producto del catálogo, opcional. */
  @IsOptional() @IsInt() @Min(1)
  systemId?: number;

  @IsOptional() @IsIn(LOG_LEVELS as readonly string[])
  minLevel?: LogLevel;
}

export class UpdateInstallationDto {
  @IsOptional() @IsIn(LOG_LEVELS as readonly string[])
  minLevel?: LogLevel;

  /** Solo se admite en INTERNA; en CLIENTE el nombre sale de la asignación. */
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;
}
