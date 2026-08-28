import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

/**
 * Lo que un administrador de cliente ve de la gente de su empresa.
 *
 * Lista blanca escrita a mano, nunca un spread de la entidad menos
 * `passwordHash`: una columna nueva en `client_users` dentro de seis meses no
 * puede publicarse sola.
 *
 * **Sin `clientId` a propósito.** La empresa es la de la sesión de quien
 * pregunta: no es un dato que esta pantalla tenga que enseñar, y no ponerlo
 * evita que el frontend caiga en la tentación de mandarlo de vuelta.
 */
export interface PortalClientUserView {
  id: number;
  fullName: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Alta de una invitación desde el portal. **Sin `clientId` y sin `isAdmin`.**
 *
 * No es una omisión: con el `ValidationPipe` global (`forbidNonWhitelisted`)
 * mandarlos devuelve 400 antes de llegar al servicio, y aunque llegaran, el
 * servicio construye la fila campo a campo y no los leería. Un administrador
 * de cliente no puede nombrar administradores (decisión 2 de la spec), y la
 * empresa sale de la sesión.
 */
export class InvitePortalUserDto {
  @IsEmail({}, { message: 'Escribe un correo electrónico válido.' })
  @Length(1, 180, { message: 'El correo no puede pasar de 180 caracteres.' })
  email!: string;

  // `trim` antes de validar: un nombre de solo espacios pasaría Length(1, 180)
  // y crearía una invitación con el nombre en blanco. Ya pasó con los
  // tickets y con el alta de requerimientos (`create-portal-requirement.dto.ts`).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre es obligatorio.' })
  @Length(1, 180, { message: 'El nombre es obligatorio y no puede pasar de 180 caracteres.' })
  fullName!: string;
}

/**
 * Lo que el administrador ve de una invitación pendiente.
 *
 * **Ni el secreto ni la huella.** El secreto solo existe en el correo; la
 * huella no le sirve de nada a nadie fuera de la base y publicarla sería
 * regalar la mitad del trabajo a quien quisiera atacar el índice.
 *
 * `deliveryFailed` es un booleano derivado y no el texto del error: por qué
 * exactamente rechazó el servidor SMTP es información de diagnóstico interno,
 * y el administrador solo necesita saber que tiene que reenviar.
 */
export interface PortalInvitationView {
  id: number;
  fullName: string;
  email: string;
  expiresAt: string;
  lastSentAt: string | null;
  deliveryFailed: boolean;
  createdAt: string;
}
