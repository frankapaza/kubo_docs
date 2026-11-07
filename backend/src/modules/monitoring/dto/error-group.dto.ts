import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ErrorGroupStatus } from '../domain/error-group-state';

/** `YYYY-MM-DD` (día de Perú) o instante ISO 8601 con zona. */
const FECHA = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Filtros de la lista de errores. Los números llegan de la query string como
 * texto; la conversión implícita del `ValidationPipe` global los convierte.
 */
export class ErrorListQueryDto {
  /** Id de cliente o `interno` (instalaciones propias, `client_id` nulo). */
  @IsOptional() @Matches(/^(interno|[1-9]\d*)$/, { message: 'cliente debe ser un id o «interno»' })
  cliente?: string;

  @IsOptional() @IsInt() @Min(1)
  sistemaId?: number;

  @IsOptional() @IsString() @MaxLength(100)
  aplicativo?: string;

  @IsOptional() @IsString() @MaxLength(100)
  servidor?: string;

  @IsOptional() @IsIn(['NUEVO', 'CON_TICKET', 'RESUELTO'])
  status?: ErrorGroupStatus;

  @IsOptional() @Matches(FECHA, { message: 'desde debe ser YYYY-MM-DD o ISO 8601 con zona' })
  desde?: string;

  @IsOptional() @Matches(FECHA, { message: 'hasta debe ser YYYY-MM-DD o ISO 8601 con zona' })
  hasta?: string;

  @IsOptional() @IsString() @MaxLength(200)
  q?: string;

  @IsOptional() @IsIn(['ultima', 'cantidad'])
  orden?: 'ultima' | 'cantidad';

  @IsOptional() @IsInt() @Min(1)
  ticketId?: number;

  @IsOptional() @IsInt() @Min(1)
  page?: number;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

/** Cliente y asignación elegidos en el diálogo cuando el error no trae los suyos. */
export class CreateTicketFromErrorDto {
  @IsOptional() @IsInt() @Min(1)
  clientId?: number;

  /** `client_systems.id` (la asignación), como en el alta de tickets del panel. */
  @IsOptional() @IsInt() @Min(1)
  systemId?: number;
}

export class ResolveErrorDto {
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
