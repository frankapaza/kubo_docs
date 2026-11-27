import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { WorkItemsRepository, WorkItemListFilters } from './work-items.repository';
import { WorkItemEventsService } from './work-item-events.service';
import { ClientsService } from '../clients/clients.service';
import { ClientUser } from '../portal/entities/client-user.entity';
import { Project } from '../projects/entities/project.entity';

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
    if (dto.clientSystemId != null) await this.assertClientSystem(dto.clientId, dto.clientSystemId);

    const priority: WorkItemPriority = dto.priority ?? DEFAULT_PRIORITY;

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);

      // La lectura que decide la posición va dentro de la transacción, con el
      // manager transaccional, para que vea una foto consistente con las
      // escrituras que siguen (mismo criterio de orden que
      // WorkItemsRepository.listColumn). Esto NO cierra la ventana de lost
      // update: bajo REPEATABLE READ, find({ where, order }) es una lectura
      // de snapshot sin bloqueo tanto dentro como fuera de la transacción --
      // moverla adentro cambió su visibilidad, no su bloqueo. Dos altas
      // concurrentes en la misma banda de prioridad pueden seguir viendo la
      // misma foto y calcular índices solapados; el estilo de esta casa no
      // toma bloqueos pesimistas en ningún lado, así que se acepta como una
      // ventana de baja probabilidad que se autocorrige en la siguiente
      // reordenación (reorder() renumera la columna entera).
      const pending = await itemRepo.find({
        where: { status: 'PENDIENTE' },
        order: { boardOrder: 'ASC', id: 'ASC' },
      });
      const index = insertionIndex(pending.map((w) => w.priority), priority);

      const saved = await itemRepo.save(
        itemRepo.create({
          clientId: dto.clientId,
          clientSystemId: dto.clientSystemId ?? null,
          title: dto.title.trim(),
          descriptionMd: dto.descriptionMd ?? null,
          acceptanceCriteria: dto.acceptanceCriteria ?? null,
          requestType: dto.requestType ?? null,
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
    const current = await this.findByIdOrFail(id);
    if (dto.clientId !== undefined) await this.clients.findByIdOrFail(dto.clientId);
    if (dto.clientSystemId != null) {
      await this.assertClientSystem(dto.clientId ?? current.clientId, dto.clientSystemId);
    }

    const patch = { ...dto } as Partial<WorkItem>;
    // Cambiar de cliente sin elegir sistema: el del cliente anterior ya no
    // vale. Dejarlo haría que el repo de la otra empresa viera este requerimiento.
    const clientChanged = dto.clientId !== undefined && Number(dto.clientId) !== Number(current.clientId);
    if (clientChanged && dto.clientSystemId === undefined) patch.clientSystemId = null;

    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  /**
   * Pasa un requerimiento a otro cliente (p. ej. uno que se pidió a nombre de
   * la empresa equivocada). Con el cliente se mueve lo que cuelga de él:
   *
   *  - el **sistema**: una asignación activa del cliente nuevo, o ninguno;
   *  - el **usuario del cliente** que lo pidió y recibe los avisos: uno activo
   *    del cliente nuevo, o ninguno. Nunca se queda uno del cliente anterior;
   *  - el **proyecto**, que se suelta si era del cliente anterior.
   *
   * Si vino del portal, deja de verse en el del cliente anterior y pasa al del
   * nuevo (la visibilidad del portal es `origin` + `client_id`).
   */
  async changeClient(
    id: number,
    actorUserId: number,
    input: { clientId: number; clientSystemId?: number | null; clientUserId?: number | null },
  ): Promise<WorkItem> {
    const current = await this.findByIdOrFail(id);
    if (Number(current.clientId) === Number(input.clientId)) {
      throw new BadRequestException({ code: 'BAD_INPUT', message: 'El requerimiento ya es de ese cliente.' });
    }
    const target = await this.clients.findByIdOrFail(input.clientId);
    const previous = await this.clients.findByIdOrFail(current.clientId).catch(() => null);
    const clientSystemId = input.clientSystemId ?? null;
    if (clientSystemId !== null) await this.assertClientSystem(input.clientId, clientSystemId);

    const updated = await this.repo.runInTransaction(async (manager) => {
      let clientUserId: number | null = null;
      if (input.clientUserId !== undefined && input.clientUserId !== null) {
        const u = await manager.getRepository(ClientUser).findOneBy({ id: input.clientUserId });
        if (!u || Number(u.clientId) !== Number(input.clientId) || !Number(u.isActive)) {
          throw new BadRequestException({
            code: 'BAD_INPUT',
            message: 'El usuario elegido no es un usuario activo del cliente nuevo.',
          });
        }
        clientUserId = Number(u.id);
      }

      let projectId: number | null = current.projectId ?? null;
      if (projectId !== null) {
        const p = await manager.getRepository(Project).findOneBy({ id: projectId });
        if (!p || Number(p.clientId) !== Number(input.clientId)) projectId = null;
      }

      const itemRepo = manager.getRepository(WorkItem);
      await itemRepo.update(id, {
        clientId: input.clientId,
        clientSystemId,
        createdByClientUserId: clientUserId,
        projectId,
      });
      return (await itemRepo.findOneBy({ id }))!;
    });

    const from = previous?.razonSocial ?? `#${current.clientId}`;
    await this.events.record({
      workItemId: id,
      type: 'COMMENT',
      actorUserId,
      reason: `Cliente cambiado de «${from}» a «${target.razonSocial}».`,
      payload: { cambio: 'CLIENTE', deClienteId: Number(current.clientId), aClienteId: Number(input.clientId) },
    });
    return updated;
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

  /**
   * El sistema de un requerimiento tiene que ser una asignación activa de SU
   * cliente: si no, el requerimiento aparecería en los repos de otra empresa.
   * Lo usa también la aceptación desde el portal (controlador).
   */
  async assertClientSystem(clientId: number, clientSystemId: number): Promise<void> {
    const cs = await this.repo.findClientSystem(clientSystemId);
    if (!cs || !cs.isActive || Number(cs.clientId) !== Number(clientId)) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'El sistema elegido no pertenece a este cliente o está inactivo.',
      });
    }
  }
}
