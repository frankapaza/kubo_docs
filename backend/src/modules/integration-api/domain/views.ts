import { PortalRequirementView } from '../../portal/dto/portal-requirement.dto';
import { PortalTicketEventView } from '../../portal/dto/portal-ticket.dto';
import { portalVisibleDescription } from '../../portal/portal-tickets.service';
import { REQUIREMENT_STATUS_LABELS } from '../../portal/domain/requirement-status-labels';
import { Ticket } from '../../tickets/entities/ticket.entity';
import { PRE_BOARD_STATUSES } from '../../work-items/domain/work-item-board';
import { WorkItem } from '../../work-items/entities/work-item.entity';

/**
 * Vistas de la API de integración. Listas blancas escritas campo a campo:
 * una columna nueva en la entidad no sale por la API sin decidirlo aquí.
 */
export interface TicketApiView {
  id: number;
  codigo: string | null;
  asunto: string | null;
  descripcion: string | null;
  estado: string;
  prioridad: string;
  sistemaId: number | null;
  sistema: string | null;
  creadoEn: string;
  actualizadoEn: string;
  resueltoEn: string | null;
  cerradoEn: string | null;
  venceRespuesta: string | null;
  venceResolucion: string | null;
  slaEnRiesgo: boolean;
}

export interface TicketHistoryEntry {
  tipo: string;
  desde: string | null;
  hasta: string | null;
  fecha: string;
}

export interface TicketApiDetail extends TicketApiView {
  historial: TicketHistoryEntry[];
}

export interface RequerimientoApiView {
  id: number;
  codigo: string | null;
  titulo: string;
  descripcion: string | null;
  /** Nombre del estado tal como lo ve el cliente en el portal. */
  estado: string;
  /** Código del estado: es el valor que admite el filtro `estado`. */
  estadoCodigo: string;
  prioridad: string | null;
  sistemaId: number | null;
  fechaComprometida: string | null;
  cerradoEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
  /** Solo en el detalle (sale de su historial); en la lista va null. */
  motivoRechazo: string | null;
  /** Solo en el detalle; en la lista va null. */
  preguntaPendiente: string | null;
  tipo: string | null;
}

export interface SistemaApiView {
  id: number;
  nombre: string;
}

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export function toTicketApiView(t: Ticket, systemNames: Map<number, string>): TicketApiView {
  const sistemaId = t.systemId === null || t.systemId === undefined ? null : Number(t.systemId);
  return {
    id: Number(t.id),
    codigo: t.code ?? null,
    asunto: t.subject ?? null,
    descripcion: portalVisibleDescription(t),
    estado: t.status,
    prioridad: t.priority,
    sistemaId,
    sistema: sistemaId === null ? null : (systemNames.get(sistemaId) ?? null),
    creadoEn: iso(t.createdAt) as string,
    actualizadoEn: iso(t.updatedAt) as string,
    resueltoEn: iso(t.resolvedAt),
    cerradoEn: iso(t.closedAt),
    venceRespuesta: iso(t.slaResponseDueAt),
    venceResolucion: iso(t.slaResolutionDueAt),
    slaEnRiesgo: Number(t.slaAtRisk) === 1,
  };
}

export function toHistoryEntry(e: PortalTicketEventView): TicketHistoryEntry {
  return { tipo: e.type, desde: e.fromStatus, hasta: e.toStatus, fecha: e.createdAt };
}

/**
 * Requerimiento con las mismas reglas que el portal: prioridad oculta mientras
 * no se aceptó, motivo y pregunta solo en su estado. `portal` aporta el motivo
 * de rechazo y la pregunta pendiente, que salen del historial (solo el detalle
 * los calcula).
 */
export function toRequerimientoApiView(w: WorkItem, portal?: PortalRequirementView): RequerimientoApiView {
  return {
    id: Number(w.id),
    codigo: w.code ?? null,
    titulo: w.title,
    descripcion: w.descriptionMd ?? null,
    estado: REQUIREMENT_STATUS_LABELS[w.status],
    estadoCodigo: w.status,
    prioridad: PRE_BOARD_STATUSES.includes(w.status) ? null : w.priority,
    sistemaId: w.clientSystemId === null || w.clientSystemId === undefined ? null : Number(w.clientSystemId),
    fechaComprometida: w.dueDate ? String(w.dueDate).slice(0, 10) : null,
    cerradoEn: iso(w.closedAt),
    creadoEn: iso(w.createdAt) as string,
    actualizadoEn: iso(w.updatedAt) as string,
    motivoRechazo: portal?.rejectionReason ?? null,
    preguntaPendiente: portal?.pendingQuestion ?? null,
    tipo: w.requestType ?? null,
  };
}
