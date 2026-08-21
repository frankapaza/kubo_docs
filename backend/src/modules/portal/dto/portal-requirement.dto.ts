import { WorkItemPriority } from '../../work-items/domain/work-item-board';

/** Cómo se le llama a cada estado de cara al cliente. */
export type PortalRequirementStatusLabel =
  | 'Solicitado'
  | 'Aceptado, en cola'
  | 'En desarrollo'
  | 'En pruebas'
  | 'Entregado'
  | 'Bloqueado'
  | 'Cancelado'
  | 'Rechazado';

/**
 * Lo único que el portal publica de un requerimiento. Lista blanca: lo que no
 * está aquí no sale, y añadir un campo es una decisión, no un descuido.
 *
 * Fuera quedan a propósito `labels`, `boardOrder`, `projectId`,
 * `assigneeUserId`, `acceptanceCriteria` y `createdBy`.
 */
export interface PortalRequirementView {
  id: number;
  code: string | null;
  title: string;
  descriptionMd: string | null;
  status: PortalRequirementStatusLabel;
  /** `null` mientras esté en SOLICITADO: antes de aceptar no hay compromiso. */
  priority: WorkItemPriority | null;
  /** Fecha comprometida (`due_date`), `YYYY-MM-DD`. `null` hasta la aceptación. */
  committedDate: string | null;
  closedAt: string | null;
  createdAt: string;
  /** Solo cuando el estado es Rechazado. */
  rejectionReason: string | null;
}
