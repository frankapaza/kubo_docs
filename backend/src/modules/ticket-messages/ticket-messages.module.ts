import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TicketAttachment } from './entities/ticket-attachment.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { PortalMessagesController } from './portal-messages.controller';
import { TicketAttachmentsService } from './ticket-attachments.service';
import { TicketMessagesController } from './ticket-messages.controller';
import { TicketMessagesRepository } from './ticket-messages.repository';
import { TicketMessagesService } from './ticket-messages.service';
import { StorageModule } from '../../common/storage/storage.module';
import { TicketsModule } from '../tickets/tickets.module';

/**
 * El hilo de mensajes de un ticket y sus adjuntos.
 *
 * Importa `TicketsModule` porque el servicio del hilo escribe también sobre el
 * ticket: necesita su repositorio (que es quien abre la transacción),
 * `SlaService` para reanudar el reloj y `TicketEventsService` para el tipo de
 * evento de la transición. La dependencia va en un solo sentido -- `tickets` no
 * conoce este módulo -- así que no hay ciclo.
 *
 * Y `StorageModule` --no `AudioModule`-- para el `STORAGE_SERVICE` con el que
 * el servicio de adjuntos escribe y lee archivos: ver la cabecera de ese módulo
 * sobre por qué el proveedor se extrajo en vez de arrastrar aquí la cola de
 * transcripción entera.
 *
 * Dos controladores, dos puertas al **mismo** servicio, que es quien tiene la
 * política: `TicketMessagesController` para el panel interno (con
 * `JwtAuthGuard`) y `PortalMessagesController` para el portal de clientes (con
 * `ClientJwtGuard` y proyección campo por campo). El del portal vive aquí y no
 * en `PortalModule` porque lo que consume son los dos servicios de este módulo,
 * que no se exportan a nadie más; del portal solo usa el guard, el decorador y
 * el tipo del token, que son clases sueltas y no crean dependencia de módulo
 * (ni, por tanto, ciclo). La estrategia `client-jwt` la registra `PortalModule`
 * al arrancar, que es lo único que `AuthGuard('client-jwt')` necesita.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TicketMessage, TicketAttachment]),
    TicketsModule,
    StorageModule,
  ],
  controllers: [TicketMessagesController, PortalMessagesController],
  // El repositorio **no** se exporta a propósito: es quien lee y escribe el
  // hilo sin comprobar de quién es el ticket. Si otro módulo pudiera
  // inyectarlo, se saltaría `loadVisibleOrFail` sin darse cuenta y la
  // separación entre empresas pasaría a depender de que nadie se despiste. La
  // única puerta al hilo es el servicio.
  providers: [TicketMessagesRepository, TicketMessagesService, TicketAttachmentsService],
  exports: [TicketMessagesService, TicketAttachmentsService],
})
export class TicketMessagesModule {}
