import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectMember, ProjectRole } from './entities/project-member.entity';

@Injectable()
export class ProjectMembersRepository {
  constructor(
    @InjectRepository(ProjectMember) private readonly repo: Repository<ProjectMember>,
  ) {}

  listByProject(projectId: number): Promise<ProjectMember[]> {
    return this.repo.find({ where: { projectId }, order: { id: 'ASC' } });
  }

  findOne(projectId: number, userId: number): Promise<ProjectMember | null> {
    return this.repo.findOne({ where: { projectId, userId } });
  }

  async listProjectIdsForUser(userId: number): Promise<number[]> {
    const rows = await this.repo.find({
      where: { userId },
      select: { projectId: true },
    });
    return rows.map((r) => Number(r.projectId));
  }

  async add(
    projectId: number,
    userId: number,
    roleInProject: ProjectRole,
  ): Promise<ProjectMember> {
    const existing = await this.findOne(projectId, userId);
    if (existing) {
      if (existing.roleInProject !== roleInProject) {
        existing.roleInProject = roleInProject;
        return this.repo.save(existing);
      }
      return existing;
    }
    return this.repo.save(this.repo.create({ projectId, userId, roleInProject }));
  }

  async remove(projectId: number, userId: number): Promise<void> {
    await this.repo.delete({ projectId, userId });
  }
}
