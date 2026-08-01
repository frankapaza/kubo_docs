import { IsJWT } from 'class-validator';

export class PortalRefreshTokenDto {
  @IsJWT()
  refreshToken!: string;
}
