import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientRequest, ClientRequestStatus, ServiceCategory } from './entities/client-request.entity';

@Injectable()
export class ClientRequestsRepository {
  constructor(
    @InjectRepository(ClientRequest) private readonly repo: Repository<ClientRequest>,
  ) {}

  async list(params: {
    status?: ClientRequestStatus;
    clientId?: number;
    projectId?: number;
    serviceCategory?: ServiceCategory;
    q?: string;
  }): Promise<ClientRequest[]> {
    const qb = this.repo.createQueryBuilder('cr');
    if (params.status) qb.andWhere('cr.status = :s', { s: params.status });
    if (params.clientId) qb.andWhere('cr.client_id = :c', { c: params.clientId });
    if (params.projectId) qb.andWhere('cr.project_id = :p', { p: params.projectId });
    if (params.serviceCategory) qb.andWhere('cr.service_category = :cat', { cat: params.serviceCategory });
    if (params.q) {
      qb.andWhere('(cr.raw_text LIKE :q OR cr.title LIKE :q)', { q: `%${params.q}%` });
    }
    qb.orderBy('cr.created_at', 'DESC').limit(500);
    return qb.getMany();
  }

  listByClientAndRange(params: {
    clientId: number;
    from: Date;
    to: Date;
  }): Promise<ClientRequest[]> {
    return this.repo
      .createQueryBuilder('cr')
      .where('cr.client_id = :c', { c: params.clientId })
      .andWhere('cr.created_at >= :from', { from: params.from })
      .andWhere('cr.created_at < :to', { to: params.to })
      .orderBy('cr.service_category', 'ASC')
      .addOrderBy('cr.created_at', 'DESC')
      .getMany();
  }

  findById(id: number): Promise<ClientRequest | null> {
    return this.repo.findOne({ where: { id } });
  }

  create(data: Partial<ClientRequest>): Promise<ClientRequest> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<ClientRequest>): Promise<ClientRequest | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
