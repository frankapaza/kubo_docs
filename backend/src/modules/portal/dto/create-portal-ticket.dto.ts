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

export class CreatePortalTicketDto {
  /** 240 es la anchura de la columna `subject`, que sí es varchar en caracteres. */
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(DESCRIPTION_MAX_CHARS)
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  systemId?: number;
}
