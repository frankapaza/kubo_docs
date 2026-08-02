import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationTemplate } from './entities/notification-template.entity';
import { NotificationTemplatesRepository } from './notification-templates.repository';
import { NotificationTemplatesService } from './notification-templates.service';

/**
 * Capa de acceso y edición de las plantillas de aviso por correo. Sin
 * controlador todavía -- lo monta la Task 7 -- y sin el vigilante que las
 * consume para enviar correos -- Task 6. Por ahora, `NotificationTemplatesService`
 * es la única superficie: `list`/`update` para el panel, `findActive` para
 * quien despache el correo.
 */
@Module({
  imports: [TypeOrmModule.forFeature([NotificationTemplate])],
  providers: [NotificationTemplatesRepository, NotificationTemplatesService],
  exports: [NotificationTemplatesService],
})
export class NotificationsModule {}
