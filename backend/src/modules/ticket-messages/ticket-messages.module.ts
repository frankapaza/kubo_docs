import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TicketAttachment } from './entities/ticket-attachment.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { TicketMessagesRepository } from './ticket-messages.repository';
import { TicketMessagesService } from './ticket-messages.service';
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
 * Falta la parte de adjuntos (reglas de admisión de `domain/attachment-rules.ts`
 * y tope por ticket) y los controladores que exponen todo esto: llegan en
 * tareas siguientes.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TicketMessage, TicketAttachment]), TicketsModule],
  providers: [TicketMessagesRepository, TicketMessagesService],
  exports: [TicketMessagesRepository, TicketMessagesService],
})
export class TicketMessagesModule {}
