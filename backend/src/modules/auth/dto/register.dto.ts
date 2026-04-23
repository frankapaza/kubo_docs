import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Email inválido' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(100)
  password!: string;

  @IsString()
  @MinLength(3, { message: 'El nombre completo es obligatorio' })
  @MaxLength(180)
  fullName!: string;
}
