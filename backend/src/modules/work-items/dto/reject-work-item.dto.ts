import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** Mismo estilo de mensajes en español que `create-portal-requirement.dto.ts`. */
export class RejectWorkItemDto {
  // `trim` antes de validar: un motivo de solo espacios pasaría MinLength y
  // dejaría al cliente con un rechazo sin explicación.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El motivo del rechazo es obligatorio.' })
  @MinLength(5, { message: 'El motivo del rechazo debe tener al menos 5 caracteres.' })
  @MaxLength(2000, { message: 'El motivo del rechazo no puede superar los 2000 caracteres.' })
  reason!: string;
}
