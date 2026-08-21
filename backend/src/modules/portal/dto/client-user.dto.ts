import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Alta de un usuario de cliente desde el panel interno. El `clientId` viaja
 * aquí (no en la URL) porque la ruta es plana: `POST /client-users`. Es el
 * único momento en que se fija — `UpdateClientUserDto` no lo admite porque
 * mover a alguien de empresa es cambiar de quién es, y eso se hace borrando y
 * creando, no editando.
 */
export class CreateClientUserDto {
  @IsInt()
  @Min(1)
  clientId!: number;

  @IsEmail()
  @Length(1, 180)
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @Length(1, 180)
  fullName!: string;

  /**
   * Gobierna `ClientAdminGuard`: solo el usuario de cliente con `isAdmin` en
   * `true` puede pedir requerimientos desde el portal (ver
   * `client-admin.guard.ts` y la etiqueta homónima del panel interno).
   */
  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
}

/**
 * Edición de un usuario de cliente ya existente. Deliberadamente SIN
 * `clientId`: con el ValidationPipe global (`forbidNonWhitelisted`) enviarlo
 * ya devuelve 400 antes de llegar al servicio — pero esa es la segunda
 * barrera, no la primera. `ClientUsersService.update` tampoco lo leería del
 * cuerpo aunque llegara, porque construye el parche campo por campo.
 */
export class UpdateClientUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 180)
  fullName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

/**
 * Lo que el panel interno ve de un usuario de cliente. Lista blanca escrita a
 * mano: nunca un spread de la entidad menos `passwordHash`, para que una
 * columna nueva no se publique sola dentro de seis meses.
 */
export interface ClientUserView {
  id: number;
  clientId: number;
  email: string;
  fullName: string;
  isAdmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}
