import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Lo único que el cliente aporta. **No hay prioridad ni fecha**: las fija la
 * casa al aceptar, y aceptarlas aquí sería dejar que el cliente se
 * autocomprometa un plazo.
 */
export class CreatePortalRequirementDto {
  // `trim` antes de validar: un título de solo espacios pasaría MinLength(3)
  // y crearía una fila con el título en blanco. Ya pasó con los tickets.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  title!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(16383)
  descriptionMd!: string;
}
