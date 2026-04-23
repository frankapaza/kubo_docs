import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { Project, ProjectStatus } from './entities/project.entity';

@Injectable()
export class ProjectsRepository {
  constructor(@InjectRepository(Project) private readonly repo: Repository<Project>) {}

  findById(id: number): Promise<Project | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByCode(code: string): Promise<Project | null> {
    return this.repo.findOne({ where: { code } });
  }

  async listPaginated(params: {
    status?: ProjectStatus;
    projectIds?: number[];
    clientId?: number;
    page: number;
    pageSize: number;
  }): Promise<{ data: Project[]; total: number }> {
    const where: FindOptionsWhere<Project> = {};
    if (params.status) where.status = params.status;
    if (params.projectIds && params.projectIds.length > 0) {
      where.id = In(params.projectIds);
    }
    if (params.clientId) where.clientId = params.clientId;
    const [data, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    });
    return { data, total };
  }

  create(data: Partial<Project>): Promise<Project> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<Project>): Promise<Project | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
