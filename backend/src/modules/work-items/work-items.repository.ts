import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemStatus, WorkItemPriority } from './domain/work-item-board';

export type DueFilter = 'vencidos' | 'semana';

export interface WorkItemListFilters {
  clientId?: number;
  projectId?: number;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  assigneeUserId?: number;
  dueFilter?: DueFilter;
  q?: string;
}

@Injectable()
export class WorkItemsRepository {
  constructor(
    @InjectRepository(WorkItem) private readonly repo: Repository<WorkItem>,
    private readonly dataSource: DataSource,
  ) {}

  async list(filters: WorkItemListFilters): Promise<WorkItem[]> {
    const qb = this.repo.createQueryBuilder('w');

    if (filters.clientId) qb.andWhere('w.client_id = :clientId', { clientId: filters.clientId });
    if (filters.projectId) qb.andWhere('w.project_id = :projectId', { projectId: filters.projectId });
    if (filters.status) qb.andWhere('w.status = :status', { status: filters.status });
    if (filters.priority) qb.andWhere('w.priority = :priority', { priority: filters.priority });
    if (filters.assigneeUserId) {
      qb.andWhere('w.assignee_user_id = :assignee', { assignee: filters.assigneeUserId });
    }
    if (filters.dueFilter === 'vencidos') {
      qb.andWhere('w.due_date IS NOT NULL AND w.due_date < CURDATE()');
    }
    if (filters.dueFilter === 'semana') {
      qb.andWhere('w.due_date IS NOT NULL AND w.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)');
    }
    if (filters.q) {
      qb.andWhere('(w.title LIKE :q OR w.description_md LIKE :q OR w.code LIKE :q)', {
        q: `%${filters.q}%`,
      });
    }

    qb.orderBy('w.status', 'ASC').addOrderBy('w.board_order', 'ASC').limit(1000);
    return qb.getMany();
  }

  /** Los ítems de una columna, en su orden actual. Base de la reordenación. */
  listColumn(status: WorkItemStatus): Promise<WorkItem[]> {
    return this.repo.find({ where: { status }, order: { boardOrder: 'ASC', id: 'ASC' } });
  }

  findById(id: number): Promise<WorkItem | null> {
    return this.repo.findOne({ where: { id } });
  }

  create(data: Partial<WorkItem>): Promise<WorkItem> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<WorkItem>): Promise<WorkItem | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  /**
   * Escribe el board_order de cada id según su posición en el array.
   * Recibe el manager para poder correr dentro de una transacción.
   */
  async applyOrder(manager: EntityManager, orderedIds: number[]): Promise<void> {
    const repo = manager.getRepository(WorkItem);
    for (let i = 0; i < orderedIds.length; i += 1) {
      await repo.update(orderedIds[i], { boardOrder: i });
    }
  }

  /** Mismo idioma que TicketsRepository.runInTransaction. */
  runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
