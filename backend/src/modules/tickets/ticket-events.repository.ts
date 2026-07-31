import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketEvent } from './entities/ticket-event.entity';

@Injectable()
export class TicketEventsRepository {
  constructor(@InjectRepository(TicketEvent) private readonly repo: Repository<TicketEvent>) {}

  append(data: Partial<TicketEvent>): Promise<TicketEvent> {
    return this.repo.save(this.repo.create(data));
  }

  listByTicket(ticketId: number): Promise<TicketEvent[]> {
    return this.repo.find({ where: { ticketId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }
}
