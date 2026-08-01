import { Injectable, NotFoundException } from '@nestjs/common';

import { WorkItemsRepository } from './work-items.repository';
import { WorkItemEventsService } from './work-item-events.service';
import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { assertReason, reorder, WorkItemStatus, WorkItemPriority } from './domain/work-item-board';

export interface MoveInput {
  workItemId: number;
  actorUserId: number;
  toStatus: WorkItemStatus;
  toIndex: number;
  reason?: string;
}

export interface AssignInput {
  workItemId: number;
  actorUserId: number;
  assigneeUserId: number | null;
}

export interface ChangePriorityInput {
  workItemId: number;
  actorUserId: number;
  priority: WorkItemPriority;
  reason?: string;
}

@Injectable()
export class WorkItemBoardService {
  constructor(
    private readonly repo: WorkItemsRepository,
    private readonly events: WorkItemEventsService,
  ) {}

  private async findOrFail(id: number): Promise<WorkItem> {
    const w = await this.repo.findById(id);
    if (!w) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
    }
    return w;
  }

  /**
   * Única vía por la que cambian `status` y `board_order`. Cambiar de columna y
   * reordenar dentro de ella son la misma acción desde el tablero.
   */
  async move(input: MoveInput): Promise<WorkItem> {
    const current = await this.findOrFail(input.workItemId);
    const from = current.status;
    const to = input.toStatus;

    // Se valida antes de escribir nada: un movimiento rechazado no deja rastro.
    assertReason(to, input.reason);

    const reason = input.reason?.trim() || null;
    const now = new Date();

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);

      // Las lecturas que deciden el orden de las columnas van dentro de la
      // transacción, con el manager transaccional: si se leyeran antes (fuera
      // de la transacción, sin bloqueo), dos movimientos concurrentes sobre la
      // misma columna verían la misma foto, calcularían órdenes solapados y el
      // último en confirmar pisaría en silencio el orden del primero. Mismo
      // criterio de orden que WorkItemsRepository.listColumn.
      const targetColumn = await itemRepo.find({
        where: { status: to },
        order: { boardOrder: 'ASC', id: 'ASC' },
      });
      const targetIds = reorder(targetColumn.map((w) => w.id), current.id, input.toIndex);

      let sourceIds: number[] | null = null;
      if (from !== to) {
        const sourceColumn = await itemRepo.find({
          where: { status: from },
          order: { boardOrder: 'ASC', id: 'ASC' },
        });
        sourceIds = sourceColumn.map((w) => w.id).filter((id) => id !== current.id);
      }

      const patch: Partial<WorkItem> = { status: to };
      if (to === 'CERRADO') patch.closedAt = now;
      if (from === 'CERRADO' && to !== 'CERRADO') patch.closedAt = null;
      await itemRepo.update(current.id, patch);

      if (sourceIds) await this.repo.applyOrder(manager, sourceIds);
      await this.repo.applyOrder(manager, targetIds);

      // El evento se escribe con el mismo manager transaccional que el
      // movimiento y la renumeración: si algo fallara antes del commit, no
      // debe quedar un evento huérfano de un cambio que nunca ocurrió. Por eso
      // se escribe aquí directo, en vez de a través de WorkItemEventsService
      // (que usa su propio repositorio no transaccional). typeForMove sigue
      // viniendo del servicio de eventos para no duplicar la tabla de
      // correspondencias; los `null` explícitos replican los valores por
      // defecto que aplicaría WorkItemEventsService.record, para que la fila
      // quede idéntica sea cual sea el camino que la escriba.
      const eventRepo = manager.getRepository(WorkItemEvent);
      await eventRepo.save(
        eventRepo.create({
          workItemId: current.id,
          type: this.events.typeForMove(from, to),
          actorUserId: input.actorUserId,
          fromStatus: from,
          toStatus: to,
          reason,
          payload: null,
        }),
      );

      return (await itemRepo.findOne({ where: { id: current.id } }))!;
    });
  }

  async assign(input: AssignInput): Promise<WorkItem> {
    await this.findOrFail(input.workItemId);

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);
      await itemRepo.update(input.workItemId, { assigneeUserId: input.assigneeUserId });

      const eventRepo = manager.getRepository(WorkItemEvent);
      await eventRepo.save(
        eventRepo.create({
          workItemId: input.workItemId,
          type: 'ASSIGNED',
          actorUserId: input.actorUserId,
          fromStatus: null,
          toStatus: null,
          reason: null,
          payload: { assigneeUserId: input.assigneeUserId },
        }),
      );

      return (await itemRepo.findOne({ where: { id: input.workItemId } }))!;
    });
  }

  /**
   * No reordena la columna: la posición manual manda, y mover el ítem por
   * debajo del usuario sería una sorpresa. La inserción por prioridad solo
   * aplica al crear (ver WorkItemsService.create).
   */
  async changePriority(input: ChangePriorityInput): Promise<WorkItem> {
    const current = await this.findOrFail(input.workItemId);

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);
      await itemRepo.update(input.workItemId, { priority: input.priority });

      const eventRepo = manager.getRepository(WorkItemEvent);
      await eventRepo.save(
        eventRepo.create({
          workItemId: input.workItemId,
          type: 'PRIORITY_CHANGED',
          actorUserId: input.actorUserId,
          fromStatus: null,
          toStatus: null,
          reason: input.reason?.trim() || null,
          payload: { from: current.priority, to: input.priority },
        }),
      );

      return (await itemRepo.findOne({ where: { id: input.workItemId } }))!;
    });
  }
}
