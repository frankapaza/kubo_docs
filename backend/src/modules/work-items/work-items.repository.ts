import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
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
    @InjectRepository(WorkItemEvent) private readonly eventsRepo: Repository<WorkItemEvent>,
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
      // Un ítem CERRADO o CANCELADO nunca está vencido (ver dueDateStyle en
      // web/src/pages/work-items/workitem-ui.ts): ya salió del flujo, así que
      // su fecha límite dejó de significar nada. Sin este filtro, un ítem
      // cerrado con due_date pasada aparecía en "Vencidos" contradiciendo lo
      // que pinta la propia tarjeta (gris, sin marca de vencido).
      qb.andWhere("w.due_date IS NOT NULL AND w.due_date < CURDATE() AND w.status NOT IN ('CERRADO','CANCELADO')");
    }
    if (filters.dueFilter === 'semana') {
      // "Semana" es un aviso de lo próximo a vencer, no una alerta de
      // incumplimiento: mismo razonamiento que "vencidos", un ítem que ya
      // salió del flujo no tiene nada próximo que atender.
      qb.andWhere(
        "w.due_date IS NOT NULL AND w.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND w.status NOT IN ('CERRADO','CANCELADO')",
      );
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

  /**
   * Solo lo que esa empresa pidió desde el portal. Los dos filtros van
   * siempre juntos en el `where`, sin un `if` que pueda dejar caer alguno.
   */
  listPortalRequirements(clientId: number): Promise<WorkItem[]> {
    return this.repo.find({
      where: { clientId, origin: 'PORTAL' },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /** Misma frontera que `listPortalRequirements`, para un único ítem. */
  findPortalRequirement(clientId: number, id: number): Promise<WorkItem | null> {
    return this.repo.findOne({ where: { id, clientId, origin: 'PORTAL' } });
  }

  /** El motivo del rechazo más reciente de ese ítem, si lo hubo. */
  async lastRejectionReason(workItemId: number): Promise<string | null> {
    const ev = await this.eventsRepo.findOne({
      where: { workItemId, type: 'REJECTED' },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return ev?.reason ?? null;
  }
}
