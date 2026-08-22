import { Injectable, NotFoundException } from '@nestjs/common';

import { WorkItemsRepository } from '../work-items/work-items.repository';
import { WorkItem } from '../work-items/entities/work-item.entity';
import { WorkItemEvent } from '../work-items/entities/work-item-event.entity';
import { DEFAULT_PRIORITY, PRE_BOARD_STATUSES } from '../work-items/domain/work-item-board';

import { assertSessionScope, toIso } from './session-scope';
import { CreatePortalRequirementDto } from './dto/create-portal-requirement.dto';
import { PortalRequirementView } from './dto/portal-requirement.dto';
import { REQUIREMENT_STATUS_LABELS } from './domain/requirement-status-labels';

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
   * Todo lo que ese cliente pidió desde el portal, y nada más. El motivo del
   * rechazo no se busca aquí: es una consulta por ítem y en un listado de
   * veinte no tiene sentido hacerla veinte veces para descartarla diecinueve
   * (solo los rechazados la necesitan, y `findOne` sí la trae).
   *
   * Por eso el `rejectionReason` de cada fila viaja siempre en `null`, incluso
   * para un `RECHAZADO`: aquí `null` significa «no consultado», no «no hay
   * motivo». La pantalla de detalle no debe reutilizar un objeto de este
   * listado para pintarse — tiene que pedir su propia ruta (`findOne`), que sí
   * trae el motivo real.
   */
  async list(clientId: number): Promise<PortalRequirementView[]> {
    assertSessionScope(clientId, 'clientId', PortalRequirementsService.name);

    const filas = await this.repo.listPortalRequirements(clientId);
    return filas.map((w) => this.toPortalView(w, null));
  }

  /**
   * Los dos filtros —`clientId` del token y `origin = 'PORTAL'`— van en el
   * `WHERE` de `findPortalRequirement`, no en un `if` posterior aquí: la
   * consulta no debe poder devolver nunca una fila de otra empresa ni un
   * requerimiento interno, ni siquiera un instante antes de descartarla.
   */
  async findOne(clientId: number, requirementId: number): Promise<PortalRequirementView> {
    assertSessionScope(clientId, 'clientId', PortalRequirementsService.name);

    const w = await this.repo.findPortalRequirement(clientId, requirementId);
    if (!w) throw this.noExiste();

    const reason = w.status === 'RECHAZADO' ? await this.repo.lastRejectionReason(requirementId) : null;

    return this.toPortalView(w, reason);
  }

  /**
   * Un requerimiento de otra empresa, uno interno y uno que no existe dan
   * exactamente esta misma respuesta. Distinguirlos confirmaría cuáles
   * existen de verdad — de ahí 404 y nunca 403.
   */
  private noExiste(): NotFoundException {
    return new NotFoundException({
      code: 'NOT_FOUND',
      message: 'Requerimiento no encontrado',
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
      status: REQUIREMENT_STATUS_LABELS[w.status],
      // Por el estado, no por si `dueDate` está vacío ni por si el valor es el
      // por defecto: un RECHAZADO tampoco pasó nunca por la aceptación, y su
      // columna `priority` conserva el DEFAULT_PRIORITY del alta porque no
      // admite nulo — enseñarlo sería atribuirle a la casa un compromiso que
      // nadie asumió, igual que con SOLICITADO. PRE_BOARD_STATUSES es
      // justo ese conjunto: «pedido y todavía no aceptado» más «rechazado».
      priority: PRE_BOARD_STATUSES.includes(w.status) ? null : w.priority,
      committedDate: w.dueDate ?? null,
      closedAt: toIso(w.closedAt),
      createdAt: toIso(w.createdAt)!,
      rejectionReason: w.status === 'RECHAZADO' ? rejectionReason : null,
    };
  }
}
