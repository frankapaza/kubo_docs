import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MeetingNote } from './entities/meeting-note.entity';
import { MeetingsService } from './meetings.service';

const KINDS = ['NOTA', 'ACUERDO', 'TAREA'] as const;

/**
 * Notas tomadas mientras se graba (spec 2026-11-28, entrega 2). La generación del acta
 * las recibe como hechos: los acuerdos y tareas marcados entran tal cual.
 */
@Injectable()
export class MeetingNotesService {
  constructor(
    @InjectRepository(MeetingNote) private readonly repo: Repository<MeetingNote>,
    private readonly meetings: MeetingsService,
  ) {}

  list(meetingId: number): Promise<MeetingNote[]> {
    return this.repo.find({ where: { meetingId }, order: { offsetSec: 'ASC', id: 'ASC' } });
  }

  async create(meetingId: number, input: { offsetSec: number; kind: MeetingNote['kind']; text: string }, userId: number): Promise<MeetingNote> {
    await this.meetings.findByIdOrFail(meetingId);
    const text = String(input.text ?? '').trim();
    if (!text) throw new BadRequestException({ code: 'BAD_INPUT', message: 'La nota está vacía.' });
    if (!KINDS.includes(input.kind)) throw new BadRequestException({ code: 'BAD_INPUT', message: 'Tipo de nota inválido.' });
    if (!Number.isInteger(input.offsetSec) || input.offsetSec < 0) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'Minuto inválido.' });
    }
    return this.repo.save(
      this.repo.create({ meetingId, offsetSec: input.offsetSec, kind: input.kind, text: text.slice(0, 2000), createdByUserId: userId }),
    );
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete({ id });
  }
}
