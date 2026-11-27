import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { CurrentClientUser } from '../portal/decorators/current-client-user.decorator';
import { ClientAdminGuard } from '../portal/guards/client-admin.guard';
import { ClientJwtGuard } from '../portal/guards/client-jwt.guard';
import { AuthClientUser } from '../portal/strategies/client-jwt.strategy';
import { ApiKeysService, ApiKeyView, IssuedApiKey } from './api-keys.service';

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(80)
  nombre!: string;
}

/**
 * Portal: cualquier administrador del cliente gestiona todas las claves de su
 * empresa. El `clientId` sale siempre del token.
 */
@Controller('portal/integraciones/claves')
@UseGuards(ClientJwtGuard, ClientAdminGuard)
export class PortalApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@CurrentClientUser() user: AuthClientUser): Promise<ApiKeyView[]> {
    return this.keys.list(user.clientId);
  }

  /** La clave en claro solo viaja aquí, una vez (`secret`, que la auditoría tacha). */
  @Post()
  @HttpCode(201)
  issue(@CurrentClientUser() user: AuthClientUser, @Body() dto: CreateApiKeyDto): Promise<IssuedApiKey> {
    return this.keys.issue(user.clientId, dto.nombre, { clientUserId: user.clientUserId });
  }

  @Post(':id/revocar')
  @HttpCode(200)
  revoke(@CurrentClientUser() user: AuthClientUser, @Param('id', ParseIntPipe) id: number): Promise<ApiKeyView> {
    return this.keys.revoke(user.clientId, id, { clientUserId: user.clientUserId });
  }
}

/** Panel: solo el personal con rol ADMIN, desde la ficha del cliente. */
@Controller('clients/:clientId/api-keys')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
@Roles('ADMIN')
export class StaffApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@Param('clientId', ParseIntPipe) clientId: number): Promise<ApiKeyView[]> {
    return this.keys.list(clientId);
  }

  @Post()
  @HttpCode(201)
  issue(
    @CurrentUser() user: AuthUser,
    @Param('clientId', ParseIntPipe) clientId: number,
    @Body() dto: CreateApiKeyDto,
  ): Promise<IssuedApiKey> {
    return this.keys.issue(clientId, dto.nombre, { userId: user.id });
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('clientId', ParseIntPipe) clientId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiKeyView> {
    return this.keys.revoke(clientId, id, { userId: user.id });
  }
}
