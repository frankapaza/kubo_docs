import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { WorkItemsRepository, WorkItemListFilters } from './work-items.repository';
import { WorkItemEventsService } from './work-item-events.service';
import { ClientsService } from '../clients/clients.service';
import { ProjectsService } from '../projects/projects.service';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { insertionIndex, reorder, DEFAULT_PRIORITY, WorkItemPriority } from './domain/work-item-board';

@Injectable()
export class WorkItemsService {
  constructor(
    private readonly repo: WorkItemsRepository,
    private readonly events: WorkItemEventsService,
    private readonly clients: ClientsService,
    private readonly projects: ProjectsService,
  ) {}

  async findByIdOrFail(id: number): Promise<WorkItem> {
    const w = await this.repo.findById(id);
    if (!w) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
    }
    return w;
  }

  list(filters: WorkItemListFilters): Promise<WorkItem[]> {
    return this.repo.list(filters);
  }

  async findWithTimeline(id: number): Promise<{ workItem: WorkItem; timeline: WorkItemEvent[] }> {
    const workItem = await this.findByIdOrFail(id);
    const timeline = await this.events.listByItem(id);
    return { workItem, timeline };
  }

  async create(userId: number, dto: CreateWorkItemDto): Promise<WorkItem> {
    await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId !== undefined) await this.projects.findById(dto.projectId);

    const priority: WorkItemPriority = dto.priority ?? DEFAULT_PRIORITY;
    const pending = await this.repo.listColumn('PENDIENTE');
    const index = insertionIndex(pending.map((w) => w.priority), priority);

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);

      const saved = await itemRepo.save(
        itemRepo.create({
          clientId: dto.clientId,
          projectId: dto.projectId ?? null,
          title: dto.title.trim(),
          descriptionMd: dto.descriptionMd ?? null,
          acceptanceCriteria: dto.acceptanceCriteria ?? null,
          labels: dto.labels ?? null,
          priority,
          status: 'PENDIENTE',
          assigneeUserId: dto.assigneeUserId ?? null,
          dueDate: dto.dueDate ?? null,
          boardOrder: index,
          createdBy: userId,
        }),
      );

      // El código depende del id autoincremental, así que se asigna después.
      const code = this.buildCode(saved.id);
      await itemRepo.update(saved.id, { code });

      // Renumera la columna con el ítem nuevo en su posición por prioridad.
      const orderedIds = reorder(pending.map((w) => w.id), saved.id, index);
      await this.repo.applyOrder(manager, orderedIds);

      // El evento CREATED se escribe con el mismo manager transaccional que el
      // alta, el código y la renumeración: si algo falla antes del commit, no
      // debe quedar un evento huérfano de un ítem que nunca existió. Por eso
      // se escribe aquí directo, en vez de a través de WorkItemEventsService
      // (que usa su propio repositorio no transaccional). Los valores por
      // defecto que normalmente aplica el servicio (reason -> null, etc.) se
      // replican a mano para que la fila quede idéntica a una escrita por él.
      const eventRepo = manager.getRepository(WorkItemEvent);
      await eventRepo.save(
        eventRepo.create({
          workItemId: saved.id,
          type: 'CREATED',
          actorUserId: userId,
          fromStatus: null,
          toStatus: 'PENDIENTE',
          reason: null,
          payload: { priority },
        }),
      );

      // saved ya trae todos los campos escritos; solo falta reflejar el
      // código asignado justo arriba, sin una lectura extra dentro de la
      // transacción.
      return { ...saved, code };
    });
  }

  private buildCode(id: number): string {
    return `RQ-${String(id).padStart(4, '0')}`;
  }

  async update(id: number, dto: UpdateWorkItemDto): Promise<WorkItem> {
    await this.findByIdOrFail(id);
    if (dto.clientId !== undefined) await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId !== undefined) await this.projects.findById(dto.projectId);

    const updated = await this.repo.update(id, { ...dto } as Partial<WorkItem>);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    const w = await this.findByIdOrFail(id);
    if (w.status !== 'PENDIENTE') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Solo se puede borrar un requerimiento pendiente. Cancélalo en su lugar.',
      });
    }
    await this.repo.remove(id);
  }
}
