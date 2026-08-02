import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { PORTAL_REFRESH_THROTTLE } from '../../config/throttler.config';
import { PortalAuthService, PortalAuthResponse } from './portal-auth.service';
import { PortalLoginDto } from './dto/portal-login.dto';
import { PortalRefreshTokenDto } from './dto/portal-refresh-token.dto';

/**
 * Puerta de entrada del portal de clientes. Sin guard de sesión —aún no hay
 * sesión que exigir— pero sí con limitación de intentos: estas dos rutas son
 * las únicas del producto alcanzables sin token, y sin límite el login admite
 * unos 25 intentos por segundo y conexión.
 *
 * El guard va a nivel de controlador para que cubra las dos rutas y para que
 * añadir una tercera aquí la herede sin que nadie tenga que acordarse. Los
 * límites y su porqué están en `config/throttler.config.ts`.
 */
@Controller('portal/auth')
@UseGuards(ApiThrottlerGuard)
export class PortalAuthController {
  constructor(private readonly portalAuth: PortalAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: PortalLoginDto): Promise<PortalAuthResponse> {
    return this.portalAuth.login(dto.email, dto.password);
  }

  /** Más laxo que el login: verificar una firma no es probar una contraseña. */
  @Post('refresh')
  @HttpCode(200)
  @Throttle(PORTAL_REFRESH_THROTTLE)
  refresh(@Body() dto: PortalRefreshTokenDto): Promise<PortalAuthResponse> {
    return this.portalAuth.refresh(dto.refreshToken);
  }
}
