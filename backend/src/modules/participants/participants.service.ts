import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Participant } from './entities/participant.entity';
import { CreateParticipantDto } from './dto/create-participant.dto';
import { UpdateParticipantDto } from './dto/update-participant.dto';

@Injectable()
export class ParticipantsService {
  constructor(
    @InjectRepository(Participant) private readonly repo: Repository<Participant>,
  ) {}

  listByMeeting(meetingId: number): Promise<Participant[]> {
    return this.repo.find({ where: { meetingId }, order: { id: 'ASC' } });
  }

  create(meetingId: number, dto: CreateParticipantDto): Promise<Participant> {
    return this.repo.save(
      this.repo.create({
        meetingId,
        userId: dto.userId ?? null,
        fullName: dto.fullName,
        documentNumber: dto.documentNumber ?? null,
        email: dto.email ?? null,
        role: dto.role ?? null,
        attended: dto.attended ? 1 : 0,
      }),
    );
  }

  async update(id: number, dto: UpdateParticipantDto): Promise<Participant> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Participante no encontrado' });
    Object.assign(p, {
      ...dto,
      attended: dto.attended === undefined ? p.attended : dto.attended ? 1 : 0,
    });
    return this.repo.save(p);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
