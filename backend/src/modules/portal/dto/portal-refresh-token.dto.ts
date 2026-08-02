import { IsJWT } from 'class-validator';

export class PortalRefreshTokenDto {
  // Mismo texto que el 401 de `PortalAuthService.refresh`: al usuario le da
  // igual si el token no es válido por su forma o por su firma, y las dos
  // respuestas acaban en el mismo sitio del frontend.
  @IsJWT({ message: 'El token de refresco no es válido.' })
  refreshToken!: string;
}
