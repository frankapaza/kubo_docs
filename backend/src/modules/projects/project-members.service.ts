import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectMembersRepository } from './project-members.repository';
import { ProjectMember, ProjectRole } from './entities/project-member.entity';
import { UsersService } from '../users/users.service';
import { ProjectsRepository } from './projects.repository';

export interface ProjectMemberWithUser {
  id: number;
  projectId: number;
  userId: number;
  roleInProject: ProjectRole;
  fullName: string;
  email: string;
  globalRole: string;
}

@Injectable()
export class ProjectMembersService {
  constructor(
    private readonly repo: ProjectMembersRepository,
    private readonly projects: ProjectsRepository,
    private readonly users: UsersService,
  ) {}

  async listByProject(projectId: number): Promise<ProjectMemberWithUser[]> {
    await this.ensureProjectExists(projectId);
    const members = await this.repo.listByProject(projectId);
    const enriched = await Promise.all(
      members.map(async (m) => {
        const u = await this.users.findByIdOrFail(Number(m.userId));
        return {
          id: Number(m.id),
          projectId: Number(m.projectId),
          userId: Number(m.userId),
          roleInProject: m.roleInProject,
          fullName: u.fullName,
          email: u.email,
          globalRole: u.role,
        };
      }),
    );
    return enriched;
  }

  async add(
    projectId: number,
    userId: number,
    roleInProject: ProjectRole = 'VIEWER',
  ): Promise<ProjectMember> {
    await this.ensureProjectExists(projectId);
    await this.users.findByIdOrFail(userId);
    return this.repo.add(projectId, userId, roleInProject);
  }

  async remove(projectId: number, userId: number): Promise<void> {
    await this.ensureProjectExists(projectId);
    await this.repo.remove(projectId, userId);
  }

  isMember(projectId: number, userId: number): Promise<boolean> {
    return this.repo.findOne(projectId, userId).then((m) => !!m);
  }

  listProjectIdsForUser(userId: number): Promise<number[]> {
    return this.repo.listProjectIdsForUser(userId);
  }

  private async ensureProjectExists(projectId: number): Promise<void> {
    const p = await this.projects.findById(projectId);
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proyecto no encontrado' });
  }
}
