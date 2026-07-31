import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { SupportAgentsRepository } from './support-agents.repository';
import { TicketsRepository } from './tickets.repository';
import { UsersRepository } from '../users/users.repository';
import { SupportAgent } from './entities/support-agent.entity';
import { CreateSupportAgentDto, UpdateSupportAgentDto } from './dto/support-agent.dto';

export interface SupportAgentView extends SupportAgent {
  fullName: string;
  email: string;
  openTickets: number;
}

@Injectable()
export class SupportAgentsService {
  constructor(
    private readonly repo: SupportAgentsRepository,
    private readonly tickets: TicketsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Enriquecido con datos del usuario y carga actual, para la UI de equipo. */
  async list(): Promise<SupportAgentView[]> {
    const [agents, load] = await Promise.all([
      this.repo.list(),
      this.tickets.countOpenByAssignee(),
    ]);

    return Promise.all(
      agents.map(async (a) => {
        const user = await this.users.findById(a.userId);
        return Object.assign({}, a, {
          fullName: user?.fullName ?? '(usuario eliminado)',
          email: user?.email ?? '',
          openTickets: load.get(a.userId) ?? 0,
        }) as SupportAgentView;
      }),
    );
  }

  async create(dto: CreateSupportAgentDto): Promise<SupportAgent> {
    const user = await this.users.findById(dto.userId);
    if (!user) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
    }
    const existing = await this.repo.findByUserId(dto.userId);
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `${user.fullName} ya está registrado como técnico de la mesa.`,
      });
    }
    return this.repo.create({
      userId: dto.userId,
      level: dto.level,
      specialties: dto.specialties ?? [],
      isActive: 1,
    });
  }

  async update(id: number, dto: UpdateSupportAgentDto): Promise<SupportAgent> {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Técnico no encontrado' });
    }
    const patch: Partial<SupportAgent> = {};
    if (dto.level !== undefined) patch.level = dto.level;
    if (dto.specialties !== undefined) patch.specialties = dto.specialties;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;

    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Técnico no encontrado' });
    }
    await this.repo.remove(id);
  }
}
