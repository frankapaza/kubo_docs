import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { WorkItemsRepository } from './work-items.repository';
import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { AcceptWorkItemDto } from './dto/accept-work-item.dto';
import { RejectWorkItemDto } from './dto/reject-work-item.dto';
import { assertReason, insertionIndex, reorder, WorkItemStatus } from './domain/work-item-board';

/**
 * La respuesta de la casa a un requerimiento pedido desde el portal: acepta
 * fijando prioridad y fecha comprometida, o rechaza con motivo. Los dos son
 * la única salida sancionada de `SOLICITADO`; `assertMovable` impide que se
 * llegue al mismo sitio arrastrando en el tablero (ver domain/work-item-board.ts).
 * Por eso los dos métodos escriben `status` directo con `itemRepo.update` en
 * vez de pasar por `WorkItemBoardService.move`: son el punto de origen de la
 * regla, no un caso que deba obedecerla.
 */
@Injectable()
export class WorkItemIntakeService {
  constructor(private readonly repo: WorkItemsRepository) {}

  /**
   * La aceptación es el acto que convierte una petición en un compromiso: aquí
   * y solo aquí se fija la fecha que el cliente verá y que el informe medirá.
   *
   * Todo va en una transacción porque son tres escrituras que no tienen
   * sentido por separado: el cambio de estado, el evento y la renumeración de
   * la columna.
   */
  async accept(id: number, actorUserId: number, dto: AcceptWorkItemDto): Promise<WorkItem> {
    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);
      const actual = await itemRepo.findOne({ where: { id } });
      if (!actual) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });

      // Por el estado, no por si `dueDate` está vacío ni por el origen: lo que
      // habilita la aceptación es estar esperándola.
      this.assertEsperandoAceptacion(actual.status);
      this.assertFechaNoPasada(dto.committedDate);

      // La columna a la que entra, leída con el manager transaccional para que
      // el orden que se calcula sea consistente con lo que se va a escribir.
      // Mismo criterio (y misma ventana aceptada de concurrencia) que
      // WorkItemsService.create.
      const pendientes = await itemRepo.find({
        where: { status: 'PENDIENTE' },
        order: { boardOrder: 'ASC', id: 'ASC' },
      });
      const index = insertionIndex(pendientes.map((w) => w.priority), dto.priority);

      await itemRepo.update(id, {
        status: 'PENDIENTE',
        priority: dto.priority,
        dueDate: dto.committedDate,
        boardOrder: index,
      });

      const eventRepo = manager.getRepository(WorkItemEvent);
      await eventRepo.save(
        eventRepo.create({
          workItemId: id,
          type: 'ACCEPTED',
          actorUserId,
          // Nulo: quien acepta es siempre alguien de casa. El cliente pide;
          // no se acepta a sí mismo.
          actorClientUserId: null,
          fromStatus: 'SOLICITADO',
          toStatus: 'PENDIENTE',
          reason: null,
          payload: { priority: dto.priority, committedDate: dto.committedDate },
        }),
      );

      // Renumera la columna con el ítem nuevo ya en su sitio.
      const orderedIds = reorder(pendientes.map((w) => w.id), id, index);
      await this.repo.applyOrder(manager, orderedIds);

      const aceptado = await itemRepo.findOne({ where: { id } });
      // No puede ser nulo: lo acabamos de actualizar dentro de la misma
      // transacción. Se comprueba igual, porque un `!` aquí es una promesa que
      // nadie vuelve a verificar.
      if (!aceptado) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
      }
      return aceptado;
    });
  }

  /**
   * El rechazo no entra en ninguna columna: no hay orden que renumerar. El
   * motivo se exige con `assertReason`, la misma comprobación que usa `move`
   * para el resto de los estados fuera de flujo (`RECHAZADO` ya está en
   * `OUT_OF_FLOW_STATUSES`) — reimplementarla aquí sería tener dos reglas de
   * "cuándo hace falta motivo" que mantener sincronizadas.
   */
  async reject(id: number, actorUserId: number, dto: RejectWorkItemDto): Promise<WorkItem> {
    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);
      const actual = await itemRepo.findOne({ where: { id } });
      if (!actual) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });

      this.assertEsperandoAceptacion(actual.status);
      assertReason('RECHAZADO', dto.reason);

      await itemRepo.update(id, { status: 'RECHAZADO' });

      const eventRepo = manager.getRepository(WorkItemEvent);
      await eventRepo.save(
        eventRepo.create({
          workItemId: id,
          type: 'REJECTED',
          actorUserId,
          actorClientUserId: null,
          fromStatus: 'SOLICITADO',
          toStatus: 'RECHAZADO',
          reason: dto.reason,
          payload: null,
        }),
      );

      const rechazado = await itemRepo.findOne({ where: { id } });
      if (!rechazado) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
      }
      return rechazado;
    });
  }

  private assertEsperandoAceptacion(status: WorkItemStatus): void {
    if (status === 'SOLICITADO') return;
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'El requerimiento no está pendiente de aceptación.',
    });
  }

  /**
   * Comparación por fecha civil, no por instante: `committedDate` es un `date`
   * sin hora, y comparar contra `new Date()` rechazaría el propio día de hoy
   * a partir de las 00:00 según la zona horaria del servidor. Este servicio
   * corre en producción en UTC y en desarrollo en hora de Lima; la diferencia
   * es de cinco horas y ya mordió una vez en las fechas de los correos.
   */
  private assertFechaNoPasada(committedDate: string): void {
    const hoy = new Date();
    const hoyCivil = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    if (committedDate >= hoyCivil) return;
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'La fecha comprometida no puede ser anterior a hoy.',
    });
  }
}
