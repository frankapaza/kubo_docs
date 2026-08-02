import {
  IsBoolean, IsOptional, IsString, Length, MaxLength, MinLength,
} from 'class-validator';

/** Ancho de `notification_templates.subject`, un `VARCHAR(300)`. */
export const SUBJECT_MAX_LENGTH = 300;

/** Lo que cabe en un `TEXT` de MySQL: 65 535 **bytes**, no caracteres. */
export const TEXT_COLUMN_MAX_BYTES = 65_535;

/**
 * Tope del cuerpo, en caracteres.
 *
 * `body_md` es un `TEXT` y MySQL corre en `STRICT_TRANS_TABLES`: pasarse no
 * trunca, **aborta**. Sin tope aquí, un cuerpo pegado desde otro sitio salía
 * como un 500 crudo (`ER_DATA_TOO_LONG`) en vez del 400 en español que el
 * editor del panel ya sabe enseñar campo por campo.
 *
 * El número no es el ancho de la columna, y no puede serlo: `MaxLength` cuenta
 * caracteres y la columna cuenta bytes. En `utf8mb4` un carácter del plano
 * básico ocupa hasta tres bytes por cada unidad que cuenta `MaxLength`, así
 * que el tope tiene que dejar sitio para ese peor caso —de otro modo un cuerpo
 * lleno de acentos pasaría la validación y reventaría el `UPDATE` igual que
 * antes—. Veinte mil caracteres son unas treinta páginas: ningún correo se
 * acerca, y por tres siguen cabiendo de sobra en los 65 535 bytes.
 */
export const BODY_MD_MAX_LENGTH = 20_000;

/**
 * Edición de una plantilla ya sembrada por la migración 015. Deliberadamente
 * SIN `audience`: cambiar el público convertiría una plantilla revisada para
 * un lector en otra cosa, sin que nadie la vuelva a revisar. Con el
 * `ValidationPipe` global (`forbidNonWhitelisted`) enviarlo ya da 400 antes
 * de llegar al servicio -- pero esa es la segunda barrera, no la primera:
 * `NotificationTemplatesService.update` tampoco lo leería del cuerpo aunque
 * llegara, porque construye el parche campo por campo.
 *
 * Los mensajes van escritos en español, como en los dto del portal: los de
 * serie de class-validator son en inglés y estos se le enseñan tal cual al
 * ADMIN que está editando el texto.
 */
export class UpdateNotificationTemplateDto {
  @IsOptional()
  @IsString({ message: 'El asunto tiene que ser texto.' })
  @Length(1, SUBJECT_MAX_LENGTH, {
    message: `El asunto no puede estar vacío ni superar los ${SUBJECT_MAX_LENGTH} caracteres.`,
  })
  subject?: string;

  @IsOptional()
  @IsString({ message: 'El cuerpo tiene que ser texto.' })
  @MinLength(1, { message: 'El cuerpo no puede estar vacío.' })
  @MaxLength(BODY_MD_MAX_LENGTH, {
    message: `El cuerpo no puede superar los ${BODY_MD_MAX_LENGTH} caracteres.`,
  })
  bodyMd?: string;

  @IsOptional()
  @IsBoolean({ message: 'El estado de la plantilla tiene que ser activo o inactivo.' })
  isActive?: boolean;
}
