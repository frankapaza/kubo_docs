import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgendaItem } from './entities/agenda-item.entity';
import { AgendaItemDto, BulkAgendaDto } from './dto/agenda-item.dto';

@Injectable()
export class AgendaService {
  constructor(
    @InjectRepository(AgendaItem) private readonly repo: Repository<AgendaItem>,
  ) {}

  listByMeeting(meetingId: number): Promise<AgendaItem[]> {
    return this.repo.find({ where: { meetingId }, order: { orderIndex: 'ASC' } });
  }

  async replaceAll(meetingId: number, dto: BulkAgendaDto): Promise<AgendaItem[]> {
    await this.repo.delete({ meetingId });
    const entities = dto.items.map((i) => this.repo.create({ ...i, meetingId }));
    return this.repo.save(entities);
  }

  async update(id: number, dto: Partial<AgendaItemDto>): Promise<AgendaItem> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ítem de agenda no encontrado' });
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
