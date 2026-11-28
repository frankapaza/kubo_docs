import { IsEmail, IsOptional, MaxLength } from 'class-validator';

/**
 * Destinatario opcional del correo de prueba de una plantilla. Sin `to`, va al
 * correo del ADMIN que lo pide. Con `to`, a esa única dirección: el contenido
 * es la plantilla guardada con datos de ejemplo, y el envío sigue limitado a 3
 * por minuto (`NOTIFICATION_TEST_THROTTLE`) y solo para ADMIN.
 */
export class SendTestDto {
  @IsOptional()
  @IsEmail({}, { message: 'El destinatario de la prueba debe ser un correo válido.' })
  @MaxLength(254)
  to?: string;
}
