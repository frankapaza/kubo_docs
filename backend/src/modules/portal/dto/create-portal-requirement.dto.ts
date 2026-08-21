import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * `description_md` es TEXT utf8mb4: su tope son 65535 **bytes**, no
 * caracteres, y un carácter puede ocupar hasta 4. 16383 es la mayor longitud
 * que cabe *siempre* (65532 bytes en el peor caso) — mismo límite y mismo
 * motivo que `DESCRIPTION_MAX_CHARS` en `create-portal-ticket.dto.ts`, que es
 * la misma clase de columna.
 */
const DESCRIPTION_MAX_CHARS = 16383;

/** 240 es la anchura de la columna `title`. */
const TITLE_MAX_CHARS = 240;

/**
 * Lo único que el cliente aporta. **No hay prioridad ni fecha**: las fija la
 * casa al aceptar, y aceptarlas aquí sería dejar que el cliente se
 * autocomprometa un plazo.
 *
 * Todos los mensajes van en español y hablan del campo tal como se llama en
 * el formulario («el título», «la descripción»), nunca de la propiedad ni de
 * la columna. Sin `message` en el decorador, el `ValidationPipe` global deja
 * pasar el literal de class-validator tal cual —inglés y con el nombre
 * interno de la propiedad dentro («descriptionMd must be shorter than or
 * equal to 16383 characters»)—, que es justo lo que
 * `create-portal-ticket.dto.ts` documenta y lo que
 * `portal-validation.integration.spec.ts` prohíbe con sus listas negras
 * `ENGLISH_LEAKS` e `INTERNAL_PROPERTY_NAMES`.
 */
export class CreatePortalRequirementDto {
  // `trim` antes de validar: un título de solo espacios pasaría MinLength(3)
  // y crearía una fila con el título en blanco. Ya pasó con los tickets.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El título es obligatorio.' })
  @MinLength(3, { message: 'El título debe tener al menos 3 caracteres.' })
  @MaxLength(TITLE_MAX_CHARS, {
    message: `El título no puede superar los ${TITLE_MAX_CHARS} caracteres.`,
  })
  title!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'La descripción es obligatoria.' })
  @MinLength(3, { message: 'La descripción debe tener al menos 3 caracteres.' })
  @MaxLength(DESCRIPTION_MAX_CHARS, {
    message: `La descripción no puede superar los ${DESCRIPTION_MAX_CHARS} caracteres.`,
  })
  descriptionMd!: string;
}
