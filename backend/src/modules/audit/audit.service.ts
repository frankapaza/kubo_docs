import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async list(params: {
    entityType?: string;
    entityId?: string;
    userId?: number;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<AuditLog>> {
    const page = Number(params.page) > 0 ? Number(params.page) : 1;
    const pageSize = Math.min(Number(params.pageSize) > 0 ? Number(params.pageSize) : 50, 200);

    const where: FindOptionsWhere<AuditLog> = {};
    if (params.entityType) where.entityType = params.entityType;
    if (params.entityId) where.entityId = params.entityId;
    if (params.userId) where.userId = params.userId;
    if (params.from && params.to) {
      where.createdAt = Between(new Date(params.from), new Date(params.to));
    }

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data, total, page, pageSize };
  }
}
