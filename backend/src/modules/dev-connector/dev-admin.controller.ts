import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { DevConnectorRepository } from './dev-connector.repository';
import { DevKeysService } from './dev-keys.service';
import { DevReposService } from './dev-repos.service';
import { CreateDevKeyDto, CreateDevRepoDto, UpdateDevRepoDto } from './dto/dev-admin.dto';

/**
 * Lado del personal del conector: registrar repos (solo `ADMIN`, porque el
 * secreto del webhook permite escribir vínculos en tickets del cliente) y
 * gestionar las claves propias (cualquier rol de desarrollo).
 */
@Controller()
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class DevAdminController {
  constructor(
    private readonly repos: DevReposService,
    private readonly keys: DevKeysService,
    private readonly data: DevConnectorRepository,
  ) {}

  @Get('dev-repos')
  listRepos(@Query('clientSystemId') clientSystemId?: string) {
    return this.repos.list(clientSystemId ? Number(clientSystemId) : undefined);
  }

  @Post('dev-repos')
  @Roles('ADMIN')
  register(@CurrentUser() user: AuthUser, @Body() dto: CreateDevRepoDto) {
    return this.repos.register(dto, user.id);
  }

  @Patch('dev-repos/:id')
  @Roles('ADMIN')
  setActive(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDevRepoDto) {
    return this.repos.setActive(id, dto.isActive);
  }

  /** El secreto anterior deja de valer en el acto: hay que pegarlo de nuevo en GitHub. */
  @Post('dev-repos/:id/webhook-secret')
  @Roles('ADMIN')
  regenerateSecret(@Param('id', ParseIntPipe) id: number) {
    return this.repos.regenerateWebhookSecret(id);
  }

  @Get('dev-keys')
  @Roles('ADMIN', 'DEVELOPER', 'SCRUM_MASTER', 'PRODUCT_OWNER')
  myKeys(@CurrentUser() user: AuthUser) {
    return this.keys.listMine(user.id);
  }

  @Post('dev-keys')
  @Roles('ADMIN', 'DEVELOPER', 'SCRUM_MASTER', 'PRODUCT_OWNER')
  issue(@CurrentUser() user: AuthUser, @Body() dto: CreateDevKeyDto) {
    return this.keys.issue(user.id, dto.devRepoId);
  }

  @Delete('dev-keys/:id')
  @HttpCode(204)
  @Roles('ADMIN', 'DEVELOPER', 'SCRUM_MASTER', 'PRODUCT_OWNER')
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.keys.revoke(user, id);
  }

  /** El código asociado a un ticket o a un requerimiento (panel «Código»). */
  @Get('dev-links')
  async links(@Query('ticketId') ticketId?: string, @Query('workItemId') workItemId?: string) {
    const t = Number(ticketId);
    const w = Number(workItemId);
    if (!(t > 0) === !(w > 0)) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Indica ticketId o workItemId (solo uno).' });
    }
    const rows = await this.data.listLinks(t > 0 ? { ticketId: t } : { workItemId: w });
    return rows.map((l) => ({
      id: Number(l.id),
      kind: l.kind,
      ref: l.ref,
      title: l.title,
      url: l.url,
      authorLogin: l.authorLogin,
      state: l.state,
      source: l.source,
      occurredAt: new Date(l.occurredAt).toISOString(),
    }));
  }
}
