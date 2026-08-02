import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Alta de ticket desde el portal. Deliberadamente NO tiene `clientId`: el del
 * ticket sale siempre del token de la sesión. Como el ValidationPipe global
 * corre con `forbidNonWhitelisted`, enviarlo devuelve 400 — pero esa es la
 * segunda barrera, no la primera: `PortalTicketsService.create` ignora el
 * cuerpo para ese dato aunque llegue.
 *
 * Tampoco admite prioridad, impacto ni urgencia: el triaje es del equipo.
 */
/**
 * `raw_text`, donde acaba la descripción, es `TEXT` con juego de caracteres
 * `utf8mb4`: su tope son 65535 **bytes**, no caracteres, y un carácter puede
 * ocupar hasta 4. Así que 16383 es la mayor longitud que cabe *siempre*
 * (65532 bytes en el peor caso). Comprobado contra la base: 16383 emojis
 * entran, 16384 dan `ERROR 1406 Data too long`.
 *
 * Sin este tope, el límite efectivo era el del cuerpo de express (100 KB): una
 * descripción de ~70 000 caracteres pasaba la validación y reventaba al
 * insertar —MySQL corre en `STRICT_TRANS_TABLES`, así que no trunca, aborta—
 * devolviendo un 500 donde correspondía un 400.
 */
const DESCRIPTION_MAX_CHARS = 16383;

/** 240 es la anchura de la columna `subject`, que sí es varchar en caracteres. */
const SUBJECT_MAX_CHARS = 240;

/**
 * Todos los mensajes van escritos, y hablan del campo tal como se llama en el
 * formulario («el asunto», «la descripción»), nunca de la propiedad ni de la
 * columna. Los literales por defecto de class-validator —«subject must be
 * shorter than or equal to 240 characters»— incumplen la restricción global de
 * mensajes en español y son la única respuesta del portal que se saltaba la
 * disciplina de proyección campo por campo del resto del módulo.
 */
export class CreatePortalTicketDto {
  @IsString({ message: 'El asunto es obligatorio.' })
  @MinLength(1, { message: 'El asunto es obligatorio.' })
  @MaxLength(SUBJECT_MAX_CHARS, {
    message: `El asunto no puede superar los ${SUBJECT_MAX_CHARS} caracteres.`,
  })
  subject!: string;

  @IsString({ message: 'La descripción es obligatoria.' })
  @MinLength(1, { message: 'La descripción es obligatoria.' })
  @MaxLength(DESCRIPTION_MAX_CHARS, {
    message: `La descripción no puede superar los ${DESCRIPTION_MAX_CHARS} caracteres.`,
  })
  description!: string;

  @IsOptional()
  @IsInt({ message: 'El sistema seleccionado no es válido.' })
  @Min(1, { message: 'El sistema seleccionado no es válido.' })
  systemId?: number;
}
