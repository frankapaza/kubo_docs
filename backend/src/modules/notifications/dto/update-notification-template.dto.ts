import {
  IsBoolean, IsOptional, IsString, Length, MinLength,
} from 'class-validator';

/**
 * Edición de una plantilla ya sembrada por la migración 015. Deliberadamente
 * SIN `audience`: cambiar el público convertiría una plantilla revisada para
 * un lector en otra cosa, sin que nadie la vuelva a revisar. Con el
 * `ValidationPipe` global (`forbidNonWhitelisted`) enviarlo ya da 400 antes
 * de llegar al servicio -- pero esa es la segunda barrera, no la primera:
 * `NotificationTemplatesService.update` tampoco lo leería del cuerpo aunque
 * llegara, porque construye el parche campo por campo.
 */
export class UpdateNotificationTemplateDto {
  @IsOptional()
  @IsString()
  @Length(1, 300)
  subject?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  bodyMd?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
