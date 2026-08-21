import { Injectable } from '@nestjs/common';

import { WorkItemsRepository } from '../work-items/work-items.repository';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { WorkItemEvent } from '../work-items/entities/work-item-event.entity';
import { DEFAULT_PRIORITY, WorkItemStatus } from '../work-items/domain/work-item-board';

import { assertSessionScope, toIso } from './session-scope';
import { CreatePortalRequirementDto } from './dto/create-portal-requirement.dto';
import { PortalRequirementStatusLabel, PortalRequirementView } from './dto/portal-requirement.dto';

/**
 * Cómo se llama cada estado de cara al cliente.
 *
 * `PENDIENTE` significa para la casa «aceptado y en cola», pero un cliente que
 * lee «Pendiente» no lo distingue de «Solicitado» — que es justo la diferencia
 * entre «lo pediste» y «nos comprometimos». El `Record` completo obliga a
 * nombrar aquí cualquier estado nuevo, o deja de compilar.
 */
const STATUS_LABELS: Record<WorkItemStatus, PortalRequirementStatusLabel> = {
  SOLICITADO: 'Solicitado',
  PENDIENTE: 'Aceptado, en cola',
  EN_PROCESO: 'En desarrollo',
  PRUEBAS: 'En pruebas',
  CERRADO: 'Entregado',
  BLOQUEADO: 'Bloqueado',
  CANCELADO: 'Cancelado',
  RECHAZADO: 'Rechazado',
};

/**
 * Alta de un requerimiento desde el portal del cliente. Todo lo que sale de
 * aquí pasa por `toPortalView`, y `clientId`/`clientUserId` entran siempre por
 * argumento desde el token — nunca desde el cuerpo, la URL ni la query.
 */
@Injectable()
export class PortalRequirementsService {
  constructor(private readonly repo: WorkItemsRepository) {}

  /**
   * Camino de escritura propio, corto, y **no** `WorkItemsService.create`.
   *
   * Aquel calcula la posición del ítem dentro de la columna PENDIENTE y
   * renumera la columna entera. Un SOLICITADO no está en ninguna columna, así
   * que ese cálculo no solo sobra: metería un ítem que el cliente aún no tiene
   * aceptado en medio del orden del tablero interno.
   *
   * Lo que sí se copia de allí es la disciplina: todo dentro de una
   * transacción, el código `RQ-` asignado después del insert porque depende
   * del id autoincremental, y el evento escrito con el mismo manager para que
   * no quede huérfano si algo falla antes del commit.
   */
  async create(
    clientUserId: number,
    clientId: number,
    dto: CreatePortalRequirementDto,
  ): Promise<PortalRequirementView> {
    // Los dos, y antes de tocar la base: un clientId falsy haría desaparecer
    // el filtro de empresa en cualquier consulta posterior, y un
    // clientUserId falsy grabaría una fila sin autor real.
    assertSessionScope(clientId, 'clientId', PortalRequirementsService.name);
    assertSessionScope(clientUserId, 'clientUserId', PortalRequirementsService.name);

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);

      const saved = await itemRepo.save(
        itemRepo.create({
          clientId,
          projectId: null,
          title: dto.title.trim(),
          descriptionMd: dto.descriptionMd.trim(),
          acceptanceCriteria: null,
          labels: null,
          priority: DEFAULT_PRIORITY,
          status: 'SOLICITADO',
          origin: 'PORTAL',
          assigneeUserId: null,
          dueDate: null,
          boardOrder: 0,
          createdBy: null,
          createdByClientUserId: clientUserId,
        }),
      );

      const code = `RQ-${String(saved.id).padStart(4, '0')}`;
      await itemRepo.update(saved.id, { code });

      const eventRepo = manager.getRepository(WorkItemEvent);
      await eventRepo.save(
        eventRepo.create({
          workItemId: saved.id,
          type: 'REQUESTED',
          actorUserId: null,
          actorClientUserId: clientUserId,
          fromStatus: null,
          toStatus: 'SOLICITADO',
          reason: null,
          payload: null,
        }),
      );

      return this.toPortalView({ ...saved, code }, null);
    });
  }

  /**
   * Lista blanca campo a campo. Nunca `{...w}` menos claves: eso publica por
   * omisión cualquier columna que alguien añada mañana a la entidad.
   */
  private toPortalView(w: WorkItem, rejectionReason: string | null): PortalRequirementView {
    return {
      id: Number(w.id),
      code: w.code ?? null,
      title: w.title,
      descriptionMd: w.descriptionMd ?? null,
      status: STATUS_LABELS[w.status],
      // Por el estado, no por si `dueDate` está vacío: la prioridad guardada es
      // el valor por defecto de la columna, y enseñarlo antes de aceptar
      // comunicaría un compromiso que nadie ha asumido.
      priority: w.status === 'SOLICITADO' ? null : w.priority,
      committedDate: w.dueDate ?? null,
      closedAt: toIso(w.closedAt),
      createdAt: toIso(w.createdAt)!,
      rejectionReason: w.status === 'RECHAZADO' ? rejectionReason : null,
    };
  }
}
