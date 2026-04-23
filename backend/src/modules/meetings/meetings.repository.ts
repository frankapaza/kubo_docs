import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, In, Repository } from 'typeorm';
import { Meeting, MeetingStatus } from './entities/meeting.entity';

@Injectable()
export class MeetingsRepository {
  constructor(@InjectRepository(Meeting) private readonly repo: Repository<Meeting>) {}

  findById(id: number): Promise<Meeting | null> {
    return this.repo.findOne({ where: { id } });
  }

  async list(params: {
    projectId?: number;
    projectIds?: number[];
    status?: MeetingStatus;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ data: Meeting[]; total: number }> {
    const where: FindOptionsWhere<Meeting> = {};
    if (params.projectId) where.projectId = params.projectId;
    else if (params.projectIds && params.projectIds.length > 0) {
      where.projectId = In(params.projectIds);
    }
    if (params.status) where.status = params.status;
    if (params.from && params.to) where.scheduledAt = Between(params.from, params.to);

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { scheduledAt: 'DESC' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    });
    return { data, total };
  }

  create(data: Partial<Meeting>): Promise<Meeting> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<Meeting>): Promise<Meeting | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
