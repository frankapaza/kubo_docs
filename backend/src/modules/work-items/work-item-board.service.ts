import { Injectable, NotFoundException } from '@nestjs/common';

import { WorkItemsRepository } from './work-items.repository';
import { WorkItemEventsService } from './work-item-events.service';
import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import {
  assertMovable,
  assertReason,
  reorder,
  WorkItemStatus,
  WorkItemPriority,
} from './domain/work-item-board';

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
    // Chequeo temprano y barato: si el ítem no existe, ni se abre transacción.
    // Su resultado no se usa para decidir nada -- ver la relectura de abajo.
    await this.findOrFail(input.workItemId);

    const to = input.toStatus;
    const reason = input.reason?.trim() || null;
    const now = new Date();

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);

      // Se relee el ítem con el manager transaccional en vez de reutilizar el
      // `current` de más arriba: `from` decide si hay que limpiar closed_at,
      // el fromStatus del evento y el tipo que le asigna typeForMove. Si se
      // usara la foto de antes de abrir la transacción, dos operaciones sobre
      // el mismo ítem (un cierre y un movimiento concurrentes, un doble clic,
      // un reintento) podrían decidir con un estado que ya no es el vigente:
      // por ejemplo, no limpiar closed_at al salir de CERRADO porque la foto
      // vieja todavía lo mostraba en otra columna.
      const current = await itemRepo.findOne({ where: { id: input.workItemId } });
      if (!current) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
      }
      const from = current.status;

      // Antes de tocar nada: un requerimiento que el cliente pidió y que nadie
      // aceptó todavía no está en ninguna columna, y arrastrarlo se saltaría la
      // aceptación — el único sitio donde se fija la fecha comprometida.
      assertMovable(from);

      // Cuando `toStatus` coincide con el estado actual es una simple
      // reordenación dentro de la columna (spec, "el orden dentro de la
      // columna"): no hay transición que auditar, nada que cerrar/reabrir y
      // nada que justificar. Solo se sabe con el `from` fresco de arriba --
      // por eso la validación de motivo, que en TicketTransitionsService se
      // hace antes de abrir la transacción, se hace aquí: en esa máquina de
      // estados CERRADO -> CERRADO es inalcanzable, así que el caso no existe;
      // aquí sí, porque cualquier columna puede ir a cualquier columna. Un
      // movimiento rechazado sigue sin dejar rastro: no se ha escrito nada
      // todavía y la transacción se revierte entera.
      const isReorder = from === to;
      if (!isReorder) {
        assertReason(to, input.reason);
      }

      // Las lecturas que deciden el orden de las columnas van dentro de la
      // transacción, con el manager transaccional, para que vean una foto
      // consistente con las escrituras que siguen (mismo criterio de orden
      // que WorkItemsRepository.listColumn). Esto NO cierra la ventana de
      // lost update: bajo REPEATABLE READ, find({ where, order }) es una
      // lectura de snapshot sin bloqueo tanto dentro como fuera de la
      // transacción -- moverla adentro cambió su visibilidad, no su bloqueo.
      // Dos movimientos concurrentes sobre la misma columna pueden seguir
      // viendo la misma foto y calcular órdenes solapados; el estilo de esta
      // casa no toma bloqueos pesimistas en ningún lado, así que se acepta
      // como una ventana de baja probabilidad que se autocorrige en la
      // siguiente reordenación (reorder() renumera la columna entera).
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
      // Guardado tras `isReorder`: en una reordenación pura `from === to`, así
      // que ninguna de las dos condiciones aplicaría de todos modos -- pero
      // sin el guard, `to === 'CERRADO'` sí se cumple cuando se reordena
      // dentro de Cerrado, y pisaría un `closed_at` real con la hora del
      // arrastre. El guard lo hace explícito en vez de depender de que las
      // dos condiciones de abajo sigan siendo mutuamente excluyentes con
      // `isReorder` para siempre.
      if (!isReorder) {
        if (to === 'CERRADO') patch.closedAt = now;
        if (from === 'CERRADO' && to !== 'CERRADO') patch.closedAt = null;
      }
      await itemRepo.update(current.id, patch);

      if (sourceIds) await this.repo.applyOrder(manager, sourceIds);
      await this.repo.applyOrder(manager, targetIds);

      // Una reordenación pura no es una transición: no se escribe evento. El
      // resto del comentario aplica solo al caso `!isReorder`.
      //
      // El evento se escribe con el mismo manager transaccional que el
      // movimiento y la renumeración: si algo fallara antes del commit, no
      // debe quedar un evento huérfano de un cambio que nunca ocurrió. Por eso
      // se escribe aquí directo, en vez de a través de WorkItemEventsService
      // (que usa su propio repositorio no transaccional). typeForMove sigue
      // viniendo del servicio de eventos para no duplicar la tabla de
      // correspondencias; los `null` explícitos replican los valores por
      // defecto que aplicaría WorkItemEventsService.record, para que la fila
      // quede idéntica sea cual sea el camino que la escriba.
      if (!isReorder) {
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
      }

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
    // Chequeo temprano y barato: si el ítem no existe, ni se abre transacción.
    // Su resultado no se usa para decidir nada -- ver la relectura de abajo.
    await this.findOrFail(input.workItemId);

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);

      // Se relee el ítem con el manager transaccional: el payload del evento
      // necesita la prioridad vigente en el momento del cambio, no la de la
      // foto tomada antes de abrir la transacción (mismo motivo que en
      // move(): dos cambios de prioridad concurrentes sobre el mismo ítem
      // podrían dejar un `from` que ya no es cierto).
      const current = await itemRepo.findOne({ where: { id: input.workItemId } });
      if (!current) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
      }

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
