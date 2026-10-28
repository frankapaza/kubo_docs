import { IsString, Length, Matches } from 'class-validator';

/**
 * La confirmación de una carga masiva.
 *
 * **Sin `clientId` a propósito, y esto es la mitad de la decisión 15 de la
 * spec.** La empresa va dentro del bloque firmado, así que no hay ningún sitio
 * donde escribir una distinta: una revisión del cliente A no se puede confirmar
 * contra el cliente B porque no existe el campo. Con el `ValidationPipe` global
 * (`forbidNonWhitelisted`), mandarlo devuelve 400 antes de llegar al servicio.
 *
 * `revision` y `mac` viajan **verbatim**: el navegador los recibe de la
 * revisión y los devuelve tal cual, sin volver a serializar nada. El MAC se
 * calcula sobre la cadena, no sobre el objeto reconstruido, así que
 * reconstruirlo en el navegador rompería la firma — y esa es exactamente la
 * propiedad que se quiere.
 */
export class ConfirmBulkInviteDto {
  @IsString({ message: 'Falta la revisión que se está confirmando.' })
  @Length(1, 200_000, { message: 'La revisión no tiene un tamaño admisible.' })
  revision!: string;

  /**
   * SHA-256 en hexadecimal: 64 caracteres. Se comprueba la forma aquí para no
   * llegar al servicio con algo que no puede casar con nada — pero **el
   * rechazo por forma y el rechazo por firma tienen que decir lo mismo**, y
   * por eso el mensaje es el mismo texto genérico: distinguirlos convertiría
   * el par de respuestas en una pista sobre la firma.
   */
  @IsString({ message: 'La revisión no es válida. Vuelve a subir el archivo.' })
  @Matches(/^[0-9a-f]{64}$/, { message: 'La revisión no es válida. Vuelve a subir el archivo.' })
  mac!: string;
}
