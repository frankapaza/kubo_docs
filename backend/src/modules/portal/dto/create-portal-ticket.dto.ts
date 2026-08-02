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
export class CreatePortalTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  subject!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  systemId?: number;
}
