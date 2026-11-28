import { ArrayMaxSize, IsArray, IsEmail, MaxLength } from 'class-validator';

/** Destinatarios de la alerta de latencia. Lista vacía = administradores activos. */
export class LatencyAlertSettingsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true, message: 'Cada destinatario debe ser un correo válido.' })
  @MaxLength(180, { each: true })
  emails!: string[];
}
