import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Todos los mensajes van escritos: sin ellos, class-validator devuelve sus
 * literales por defecto («email must be an email»), que incumplen la
 * restricción global de mensajes en español y además nombran la propiedad
 * interna en vez del campo que el usuario ve en pantalla.
 */
export class PortalLoginDto {
  @IsEmail({}, { message: 'Escribe un correo electrónico válido.' })
  email!: string;

  // Los dos decoradores dicen lo mismo a propósito: el pipe deduplica, así que
  // falte el campo o venga vacío, el usuario lee una sola frase.
  @IsString({ message: 'La contraseña es obligatoria.' })
  @MinLength(1, { message: 'La contraseña es obligatoria.' })
  password!: string;
}
