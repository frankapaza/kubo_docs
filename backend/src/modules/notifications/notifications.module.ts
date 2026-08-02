import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClientsModule } from '../clients/clients.module';
import { EmailModule } from '../email/email.module';
import { PortalModule } from '../portal/portal.module';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { WorkspaceModule } from '../workspace/workspace.module';

import { NotificationTemplate } from './entities/notification-template.entity';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { NotificationTemplatesRepository } from './notification-templates.repository';
import { NotificationTemplatesService } from './notification-templates.service';

/**
 * Plantillas de aviso por correo y el despachador que las usa. Sin controlador
 * todavía -- lo monta la Task 7 -- y sin el vigilante que drena la bandeja de
 * salida -- Task 6, que consumirá `NotificationDispatcher`.
 *
 * Las dependencias van todas en un sentido: este módulo conoce a tickets,
 * portal, clientes, usuarios, ajustes y correo; ninguno de ellos lo conoce a
 * él. Es lo que permite que los nueve puntos donde hoy se escriben eventos
 * sigan sin saber que existen las notificaciones.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationTemplate]),
    ConfigModule,
    // De cada uno se consume una sola pieza, ya exportada por su módulo:
    // TicketsRepository, ClientUsersRepository, ClientsRepository,
    // UsersService, WorkspaceService y EmailService.
    TicketsModule,
    PortalModule,
    ClientsModule,
    UsersModule,
    WorkspaceModule,
    EmailModule,
  ],
  providers: [NotificationTemplatesRepository, NotificationTemplatesService, NotificationDispatcher],
  exports: [NotificationTemplatesService, NotificationDispatcher],
})
export class NotificationsModule {}
