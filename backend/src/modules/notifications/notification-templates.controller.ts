import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { NOTIFICATION_TEST_THROTTLE } from '../../config/throttler.config';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';

import { ComposedEmail } from './domain/email-compose';
import { NotificationAudience, variablesFor } from './domain/template-renderer';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto';
import { NotificationTemplate } from './entities/notification-template.entity';
import { NotificationTemplatesService } from './notification-templates.service';

/**
 * Lo que el panel ve de una plantilla, más el catálogo de variables de su
 * propio público (`variables`). Lista blanca escrita a mano, como
 * `ClientUserView`: nunca un spread de la entidad, para que una columna
 * nueva no se publique sola dentro de seis meses.
 *
 * `variables` viaja aquí -- calculado con `variablesFor`, la misma función
 * que usa `validateTemplate` al guardar -- para que la pantalla de edición
 * (Task 8) no tenga que llevar su propia copia de qué variable es de qué
 * público: si esa copia divergiera del backend, la pantalla ofrecería una
 * variable que el guardado luego rechaza.
 */
export interface NotificationTemplateView {
  id: number;
  triggerKey: string;
  audience: NotificationAudience;
  subject: string;
  bodyMd: string;
  isActive: boolean;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  variables: readonly string[];
}

function toView(template: NotificationTemplate): NotificationTemplateView {
  return {
    id: template.id,
    triggerKey: template.triggerKey,
    audience: template.audience,
    subject: template.subject,
    bodyMd: template.bodyMd,
    isActive: template.isActive === 1,
    updatedBy: template.updatedBy,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    variables: variablesFor(template.audience),
  };
}

/**
 * Superficie del panel interno para las plantillas de aviso por correo:
 * listarlas, editarlas, previsualizarlas y mandarse una prueba.
 *
 * Todo bajo `StaffOnlyGuard` + rol `ADMIN` en lo que muta o dispara un envío:
 * son textos que salen en nombre de Kubo a clientes reales, no algo que deba
 * tocar cualquier miembro del equipo.
 *
 * **Nota para quien construya la pantalla de previsualización (Task 8):** el
 * `bodyMd` de una plantilla no se escapa al guardarse -- ver el comentario en
 * `notification-templates.service.ts` y en `domain/email-compose.ts` --, así
 * que un ADMIN puede escribir HTML crudo y el `html` que devuelve `preview`
 * lo trae tal cual, sin sanear. Es deliberado (son correos, y un enlace o una
 * negrita son útiles; quien edita es personal con rol de administración; y el
 * destinatario real lo abre en un cliente de correo que ya sanea), pero
 * significa que la pantalla tiene que renderizar ese `html` de forma aislada
 * -- un `iframe` en `sandbox`, o `srcDoc` -- y nunca inyectarlo directamente
 * en el DOM del propio panel.
 */
@Controller('notification-templates')
@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)
export class NotificationTemplatesController {
  constructor(private readonly service: NotificationTemplatesService) {}

  @Get()
  async list(): Promise<NotificationTemplateView[]> {
    const rows = await this.service.list();
    return rows.map(toView);
  }

  @Patch(':id')
  @Roles('ADMIN')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationTemplateDto,
  ): Promise<NotificationTemplateView> {
    const updated = await this.service.update(id, user.id, dto);
    return toView(updated);
  }

  /**
   * Sin `@Body()`: la previsualización no toma nada del cuerpo de la
   * petición, solo el id de la plantilla ya guardada. Compone con datos de
   * ejemplo por el mismo camino que el envío real y no manda nada.
   */
  @Post(':id/preview')
  @Roles('ADMIN')
  preview(@Param('id', ParseIntPipe) id: number): Promise<ComposedEmail> {
    return this.service.preview(id);
  }

  /**
   * El destinatario es SIEMPRE `user.email`, sacado del token -- nunca del
   * cuerpo de la petición. No se declara ningún `@Body()` en este método a
   * propósito: así, aunque alguien mande un `to` en el cuerpo (desde el
   * frontend o con curl), ese campo ni siquiera se lee. Un endpoint
   * autenticado que mandara correo a donde le digan sería un relé de spam con
   * credenciales.
   */
  @Post(':id/test')
  @Roles('ADMIN')
  @UseGuards(ApiThrottlerGuard)
  @Throttle(NOTIFICATION_TEST_THROTTLE)
  sendTest(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ): Promise<{ to: string }> {
    return this.service.sendTest(id, user.email);
  }
}
