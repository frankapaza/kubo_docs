import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { LOG_LEVELS, LogLevel } from '../domain/log-level';

/** `YYYY-MM-DD` (día de Perú) o instante ISO 8601 con zona. */
const FECHA = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Filtros de la búsqueda de logs. Los números llegan de la query string como
 * texto; la conversión implícita del `ValidationPipe` global los convierte.
 * Todo lo que acaba en un selector de Loki lleva tope de longitud.
 */
export class LogSearchQueryDto {
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  instalacionId?: number;

  /** Id de cliente o `interno` (instalaciones propias). */
  @IsOptional() @Matches(/^(\d+|interno)$/, { message: 'cliente debe ser un id o «interno»' })
  cliente?: string;

  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  sistemaId?: number;

  @IsOptional() @IsString() @MaxLength(100)
  aplicativo?: string;

  @IsOptional() @IsString() @MaxLength(100)
  servidor?: string;

  /** Nivel mínimo: trae ese nivel y los más graves. */
  @IsOptional() @IsIn(LOG_LEVELS as readonly string[])
  nivel?: LogLevel;

  @IsOptional() @IsString() @MaxLength(200)
  q?: string;

  @IsOptional() @Matches(FECHA, { message: 'desde debe ser YYYY-MM-DD o ISO 8601 con zona' })
  desde?: string;

  @IsOptional() @Matches(FECHA, { message: 'hasta debe ser YYYY-MM-DD o ISO 8601 con zona' })
  hasta?: string;

  /** ns (cadena de dígitos) de la página anterior; no es un número de JS. */
  @IsOptional() @Matches(/^\d{1,19}$/, { message: 'cursor inválido' })
  cursor?: string;

  /** El tope real (500) lo aplica el servicio; aquí solo se descarta lo absurdo. */
  @IsOptional() @IsInt() @Min(1)
  limit?: number;
}
