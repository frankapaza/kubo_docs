import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsRepository } from './projects.repository';
import { ProjectMembersService } from './project-members.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateJiraConfigDto } from './dto/jira-config.dto';
import { Project, ProjectStatus } from './entities/project.entity';
import { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly repo: ProjectsRepository,
    private readonly members: ProjectMembersService,
  ) {}

  async create(userId: number, dto: CreateProjectDto): Promise<Project> {
    const exists = await this.repo.findByCode(dto.code);
    if (exists) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Código de proyecto duplicado' });
    }
    const project = await this.repo.create({
      code: dto.code,
      jiraCode: dto.jiraCode?.toUpperCase() ?? null,
      name: dto.name,
      description: dto.description ?? null,
      status: 'ACTIVE',
      clientId: dto.clientId ?? null,
      createdBy: userId,
    });
    await this.members.add(Number(project.id), userId, 'OWNER');
    return project;
  }

  async findById(id: number): Promise<Project> {
    const p = await this.repo.findById(id);
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proyecto no encontrado' });
    return p;
  }

  async findByIdForUser(id: number, user: AuthUser): Promise<Project> {
    const project = await this.findById(id);
    if (!this.hasFullAccess(user)) {
      const allowed = await this.members.isMember(id, user.id);
      if (!allowed) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'No tienes acceso a este proyecto',
        });
      }
    }
    return project;
  }

  async listForUser(
    user: AuthUser,
    params: { status?: ProjectStatus; clientId?: number; page?: number; pageSize?: number },
  ): Promise<PaginatedResponse<Project>> {
    const page = Number(params.page) > 0 ? Number(params.page) : 1;
    const pageSize = Math.min(Number(params.pageSize) > 0 ? Number(params.pageSize) : 20, 100);

    if (this.hasFullAccess(user)) {
      const { data, total } = await this.repo.listPaginated({
        status: params.status,
        clientId: params.clientId,
        page,
        pageSize,
      });
      return { data, total, page, pageSize };
    }

    const ids = await this.members.listProjectIdsForUser(user.id);
    if (ids.length === 0) return { data: [], total: 0, page, pageSize };

    const { data, total } = await this.repo.listPaginated({
      status: params.status,
      projectIds: ids,
      clientId: params.clientId,
      page,
      pageSize,
    });
    return { data, total, page, pageSize };
  }

  async update(id: number, dto: UpdateProjectDto): Promise<Project> {
    await this.findById(id);
    const patch: Partial<Project> = { ...dto } as Partial<Project>;
    if (patch.jiraCode) patch.jiraCode = patch.jiraCode.toUpperCase();
    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async updateJiraConfig(id: number, dto: UpdateJiraConfigDto): Promise<Project> {
    await this.findById(id);
    const updated = await this.repo.update(id, {
      jiraIntegrationId: dto.jiraIntegrationId ?? null,
      jiraProjectKey: dto.jiraProjectKey ?? null,
    });
    return updated!;
  }

  async remove(id: number): Promise<void> {
    await this.findById(id);
    await this.repo.remove(id);
  }

  private hasFullAccess(user: AuthUser): boolean {
    return user.role === 'ADMIN';
  }
}
