import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PortalAuthService, PortalAuthResponse } from './portal-auth.service';
import { PortalLoginDto } from './dto/portal-login.dto';
import { PortalRefreshTokenDto } from './dto/portal-refresh-token.dto';

/** Puerta de entrada del portal de clientes. Sin guards: aún no hay sesión que exigir. */
@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly portalAuth: PortalAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: PortalLoginDto): Promise<PortalAuthResponse> {
    return this.portalAuth.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: PortalRefreshTokenDto): Promise<PortalAuthResponse> {
    return this.portalAuth.refresh(dto.refreshToken);
  }
}
