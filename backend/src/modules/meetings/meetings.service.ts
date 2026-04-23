import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MeetingsRepository } from './meetings.repository';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { Meeting, MeetingStatus } from './entities/meeting.entity';
import { ProjectsService } from '../projects/projects.service';
import { ProjectMembersService } from '../projects/project-members.service';
import { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly repo: MeetingsRepository,
    private readonly projects: ProjectsService,
    private readonly members: ProjectMembersService,
  ) {}

  async create(user: AuthUser, dto: CreateMeetingDto): Promise<Meeting> {
    await this.projects.findByIdForUser(dto.projectId, user);
    return this.repo.create({
      projectId: dto.projectId,
      title: dto.title,
      description: dto.description ?? null,
      scheduledAt: new Date(dto.scheduledAt),
      location: dto.location ?? null,
      status: 'SCHEDULED',
      meetingType: dto.meetingType ?? 'GENERIC',
      createdBy: user.id,
    });
  }

  async findByIdOrFail(id: number): Promise<Meeting> {
    const m = await this.repo.findById(id);
    if (!m) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reunión no encontrada' });
    return m;
  }

  async findByIdForUser(id: number, user: AuthUser): Promise<Meeting> {
    const meeting = await this.findByIdOrFail(id);
    await this.ensureUserCanAccessProject(meeting.projectId, user);
    return meeting;
  }

  async listForUser(
    user: AuthUser,
    params: {
      projectId?: number;
      status?: MeetingStatus;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<PaginatedResponse<Meeting>> {
    const page = Number(params.page) > 0 ? Number(params.page) : 1;
    const pageSize = Math.min(Number(params.pageSize) > 0 ? Number(params.pageSize) : 20, 100);

    let projectIds: number[] | undefined;
    if (user.role !== 'ADMIN') {
      projectIds = await this.members.listProjectIdsForUser(user.id);
      if (projectIds.length === 0) return { data: [], total: 0, page, pageSize };
      if (params.projectId && !projectIds.includes(Number(params.projectId))) {
        return { data: [], total: 0, page, pageSize };
      }
    }

    const { data, total } = await this.repo.list({
      projectId: params.projectId,
      projectIds: params.projectId ? undefined : projectIds,
      status: params.status,
      from: params.from ? new Date(params.from) : undefined,
      to: params.to ? new Date(params.to) : undefined,
      page,
      pageSize,
    });
    return { data, total, page, pageSize };
  }

  private async ensureUserCanAccessProject(projectId: number, user: AuthUser): Promise<void> {
    if (user.role === 'ADMIN') return;
    const ok = await this.members.isMember(projectId, user.id);
    if (!ok) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'No tienes acceso a esta reunión',
      });
    }
  }

  async update(id: number, dto: UpdateMeetingDto): Promise<Meeting> {
    await this.findByIdOrFail(id);
    const patch: Partial<Meeting> = { ...dto } as Partial<Meeting>;
    if (dto.scheduledAt) patch.scheduledAt = new Date(dto.scheduledAt);
    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async start(id: number): Promise<Meeting> {
    const m = await this.findByIdOrFail(id);
    if (m.status !== 'SCHEDULED') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: `No se puede iniciar una reunión en estado ${m.status}`,
      });
    }
    const updated = await this.repo.update(id, {
      startedAt: new Date(),
      status: 'IN_PROGRESS',
    });
    return updated!;
  }

  async end(id: number): Promise<Meeting> {
    const m = await this.findByIdOrFail(id);
    if (m.status !== 'IN_PROGRESS') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: `No se puede finalizar una reunión en estado ${m.status}`,
      });
    }
    const updated = await this.repo.update(id, {
      endedAt: new Date(),
      status: 'RECORDED',
    });
    return updated!;
  }

  async remove(id: number): Promise<void> {
    await this.findByIdOrFail(id);
    await this.repo.remove(id);
  }

  setStatus(id: number, status: MeetingStatus): Promise<Meeting | null> {
    return this.repo.update(id, { status });
  }
}
