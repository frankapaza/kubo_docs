import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';

import { Ticket, ServiceCategory } from './entities/ticket.entity';
import { TicketStatus, OPEN_STATUSES } from './domain/ticket-state-machine';
import { TicketPriority } from './domain/ticket-priority';

export interface TicketListFilters {
  status?: TicketStatus;
  open?: boolean;
  clientId?: number;
  projectId?: number;
  systemId?: number;
  priority?: TicketPriority;
  assigneeUserId?: number;
  serviceCategory?: ServiceCategory;
  atRisk?: boolean;
  q?: string;
}

@Injectable()
export class TicketsRepository {
  constructor(
    @InjectRepository(Ticket) private readonly repo: Repository<Ticket>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Ejecuta `work` dentro de una única transacción de base de datos. Quien
   * llame debe hacer todas sus escrituras a través del `EntityManager` que
   * recibe (por ejemplo `manager.getRepository(Ticket)`), no de los
   * repositorios inyectados por Nest, para que compartan la misma conexión
   * y confirmen o reviertan juntas.
   */
  runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  async list(filters: TicketListFilters): Promise<Ticket[]> {
    const qb = this.repo.createQueryBuilder('t');

    if (filters.status) qb.andWhere('t.status = :status', { status: filters.status });
    if (filters.open) qb.andWhere('t.status IN (:...open)', { open: OPEN_STATUSES });
    if (filters.clientId) qb.andWhere('t.client_id = :clientId', { clientId: filters.clientId });
    if (filters.projectId) qb.andWhere('t.project_id = :projectId', { projectId: filters.projectId });
    if (filters.systemId) qb.andWhere('t.system_id = :systemId', { systemId: filters.systemId });
    if (filters.priority) qb.andWhere('t.priority = :priority', { priority: filters.priority });
    if (filters.assigneeUserId) {
      qb.andWhere('t.assignee_user_id = :assignee', { assignee: filters.assigneeUserId });
    }
    if (filters.serviceCategory) {
      qb.andWhere('t.service_category = :cat', { cat: filters.serviceCategory });
    }
    if (filters.atRisk) qb.andWhere('t.sla_at_risk = 1');
    if (filters.q) {
      qb.andWhere('(t.raw_text LIKE :q OR t.subject LIKE :q OR t.code LIKE :q)', {
        q: `%${filters.q}%`,
      });
    }

    qb.orderBy('t.created_at', 'DESC').limit(500);
    return qb.getMany();
  }

  findById(id: number): Promise<Ticket | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByCode(code: string): Promise<Ticket | null> {
    return this.repo.findOne({ where: { code } });
  }

  create(data: Partial<Ticket>): Promise<Ticket> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<Ticket>): Promise<Ticket | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  /**
   * Firma heredada del repositorio de client_requests: la consume
   * reports.service.ts para el informe mensual de atención.
   */
  listByClientAndRange(params: { clientId: number; from: Date; to: Date }): Promise<Ticket[]> {
    return this.repo
      .createQueryBuilder('t')
      .where('t.client_id = :c', { c: params.clientId })
      .andWhere('t.created_at >= :from', { from: params.from })
      .andWhere('t.created_at < :to', { to: params.to })
      .orderBy('t.service_category', 'ASC')
      .addOrderBy('t.created_at', 'DESC')
      .getMany();
  }

  /** Carga por técnico: cuántos tickets abiertos tiene asignados cada uno. */
  async countOpenByAssignee(): Promise<Map<number, number>> {
    const rows = await this.repo
      .createQueryBuilder('t')
      .select('t.assignee_user_id', 'userId')
      .addSelect('COUNT(*)', 'total')
      .where('t.status IN (:...open)', { open: OPEN_STATUSES })
      .andWhere('t.assignee_user_id IS NOT NULL')
      .groupBy('t.assignee_user_id')
      .getRawMany<{ userId: string; total: string }>();

    return new Map(rows.map((r) => [Number(r.userId), Number(r.total)]));
  }

  /** Candidatos del job de riesgo: abiertos, no pausados y con plazo definido. */
  listOpenForRiskScan(): Promise<Ticket[]> {
    return this.repo.find({
      where: {
        status: In(OPEN_STATUSES),
        pausedAt: IsNull(),
        slaAtRisk: 0,
      },
    });
  }

  /**
   * Los tickets que esa empresa abrió dentro del periodo, para el informe
   * mensual del portal.
   *
   * Método propio y no `list(filters)`: aquel monta el filtro de empresa con
   * `if (filters.clientId)`, así que un valor falsy haría desaparecer el
   * WHERE y devolvería tickets de todas las empresas. Aquí el `where` es
   * fijo, sin condicional.
   *
   * Intervalo `[from, to)`, abierto por arriba: con `Between` (inclusivo por
   * los dos extremos) un ticket creado en el primer instante de septiembre
   * saldría en el informe de agosto **y** en el de septiembre.
   */
  listForClientPeriod(clientId: number, from: Date, to: Date): Promise<Ticket[]> {
    return this.repo.find({
      where: { clientId, capturedAt: And(MoreThanOrEqual(from), LessThan(to)) },
      order: { capturedAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Cuántos tickets de esa empresa se resolvieron dentro del periodo.
   *
   * Cuenta por `resolvedAt`, no por `capturedAt`: son criterios distintos a
   * propósito. Un ticket abierto en julio y resuelto en agosto cuenta en el
   * informe de agosto, no en el de julio. Mismo `where` fijo y mismo
   * intervalo `[from, to)` que `listForClientPeriod`.
   */
  countResolvedInPeriod(clientId: number, from: Date, to: Date): Promise<number> {
    return this.repo.count({
      where: { clientId, resolvedAt: And(MoreThanOrEqual(from), LessThan(to)) },
    });
  }
}
