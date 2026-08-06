import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TicketAttachment } from './entities/ticket-attachment.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { TicketMessagesRepository } from './ticket-messages.repository';

/**
 * El hilo de mensajes de un ticket y sus adjuntos. Solo entidades y
 * repositorio por ahora: el servicio que escribe mensajes y adjuntos (con las
 * reglas de admisión de `domain/attachment-rules.ts`, el tope por ticket y el
 * evento `MESSAGE_POSTED`) y los controladores que lo exponen llegan en tareas
 * siguientes.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TicketMessage, TicketAttachment])],
  providers: [TicketMessagesRepository],
  exports: [TicketMessagesRepository],
})
export class TicketMessagesModule {}
