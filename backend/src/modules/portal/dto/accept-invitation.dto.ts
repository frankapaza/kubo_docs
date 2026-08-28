import { IsString, MinLength } from 'class-validator';

/**
 * Lo que manda la página pública de aceptar invitación.
 *
 * **Sin correo.** Ya lo lleva la invitación, y pedirlo permitiría probar
 * direcciones: quien tuviera un enlace podría averiguar si una dirección
 * cualquiera está registrada según cómo respondiera.
 *
 * **Sin `clientId` y sin `isAdmin`.** La empresa sale de la invitación, y un
 * administrador de cliente no puede nombrar administradores. Con
 * `forbidNonWhitelisted` mandarlos ya devuelve 400 antes de llegar al
 * servicio; que además el servicio no los lea es la primera barrera, no la
 * segunda.
 *
 * El mínimo de 8 caracteres es el mismo que ya rige en `CreateClientUserDto`
 * para el alta desde el panel: aquí no se inventan reglas nuevas.
 */
export class AcceptInvitationDto {
  @IsString({ message: 'El enlace no es válido o ha caducado.' })
  @MinLength(1, { message: 'El enlace no es válido o ha caducado.' })
  secret!: string;

  @IsString({ message: 'La contraseña es obligatoria.' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  password!: string;

  @IsString({ message: 'Repite la contraseña.' })
  @MinLength(8, { message: 'Repite la contraseña.' })
  passwordConfirmation!: string;
}

/**
 * Lo único que ve la pantalla de aceptar ANTES de pedir contraseña: el
 * nombre de la persona invitada y el de su empresa. Decisión 10 de la spec
 * — la página saluda, no es un formulario a ciegas.
 *
 * Nada más. Ni correo, ni identificadores, ni quién invitó, ni fechas:
 * cualquiera de esos datos en una ruta pública sin autenticar sería
 * información de más para quien solo tiene un enlace, no una sesión.
 */
export interface InvitationPreviewView {
  fullName: string;
  clientName: string | null;
}
