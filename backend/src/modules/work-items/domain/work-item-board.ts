import { BadRequestException } from '@nestjs/common';

export type WorkItemStatus =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'PRUEBAS'
  | 'CERRADO'
  | 'BLOQUEADO'
  | 'CANCELADO'
  | 'SOLICITADO'
  | 'RECHAZADO';

export const WORK_ITEM_STATUSES: WorkItemStatus[] = [
  'PENDIENTE',
  'EN_PROCESO',
  'PRUEBAS',
  'CERRADO',
  'BLOQUEADO',
  'CANCELADO',
  'SOLICITADO',
  'RECHAZADO',
];

/** Las cuatro columnas de flujo del tablero, en orden de izquierda a derecha. */
export const BOARD_COLUMNS: WorkItemStatus[] = [
  'PENDIENTE',
  'EN_PROCESO',
  'PRUEBAS',
  'CERRADO',
];

/** Estados fuera del flujo: no son columnas, exigen motivo. */
export const OUT_OF_FLOW_STATUSES: WorkItemStatus[] = ['BLOQUEADO', 'CANCELADO', 'RECHAZADO'];

export type WorkItemPriority = 'ALTA' | 'MEDIA' | 'BAJA';

export const WORK_ITEM_PRIORITIES: WorkItemPriority[] = ['ALTA', 'MEDIA', 'BAJA'];

export const DEFAULT_PRIORITY: WorkItemPriority = 'MEDIA';

/** Menor número, mayor prioridad. */
const PRIORITY_RANK: Record<WorkItemPriority, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };

/**
 * A diferencia de los tickets, aquí no hay máquina de estados: cualquier columna
 * puede ir a cualquier columna. La única restricción es dejar constancia del
 * motivo al sacar un ítem del flujo.
 */
export function requiresReason(toStatus: WorkItemStatus): boolean {
  return OUT_OF_FLOW_STATUSES.includes(toStatus);
}

export function assertReason(toStatus: WorkItemStatus, reason: string | null | undefined): void {
  if (!requiresReason(toStatus)) return;
  if (reason && reason.trim().length > 0) return;
  throw new BadRequestException({
    code: 'BAD_INPUT',
    message: `Pasar a «${toStatus}» exige indicar un motivo.`,
  });
}

/**
 * Estados anteriores al tablero: un requerimiento que el cliente pidió y que
 * nadie ha aceptado todavía, y uno que se rechazó.
 *
 * No son columnas y **no se llega a ellos ni se sale de ellos arrastrando**.
 * Se sale por `WorkItemIntakeService.accept` o `.reject`, que son los únicos
 * sitios donde se fija la fecha comprometida o se exige el motivo.
 */
export const PRE_BOARD_STATUSES: WorkItemStatus[] = ['SOLICITADO', 'RECHAZADO'];

/**
 * Exige que el ítem ya esté en el tablero antes de dejar que alguien lo mueva.
 *
 * Hace falta porque aquí no hay máquina de estados: `move` acepta cualquier
 * columna de destino desde cualquier origen. Sin esta guarda, arrastrar una
 * tarjeta llevaría un SOLICITADO directo a EN_PROCESO y se saltaría la
 * aceptación entera — que es lo único que garantiza que exista una fecha
 * comprometida, de la que depende el informe mensual del cliente.
 *
 * Se comprueba el estado de ORIGEN, no el de destino: lo que está prohibido es
 * sacar de aquí arrastrando, no llegar aquí (a `SOLICITADO` no llega nada, y a
 * `RECHAZADO` solo llega `reject`).
 */
export function assertMovable(fromStatus: WorkItemStatus): void {
  if (!PRE_BOARD_STATUSES.includes(fromStatus)) return;

  const message =
    fromStatus === 'SOLICITADO'
      ? 'El requerimiento aún no ha sido aceptado: acéptalo antes de moverlo en el tablero.'
      : 'El requerimiento fue rechazado y no vuelve al tablero.';

  throw new BadRequestException({ code: 'BAD_INPUT', message });
}

/**
 * Orden final de una columna tras soltar `movedId` en la posición `toIndex`.
 *
 * Sirve tanto para reordenar dentro de la misma columna (el id ya está en la
 * lista) como para recibir un ítem de otra (no está). Se renumera la columna
 * entera: con decenas de ítems es imperceptible y evita los casos borde de los
 * rangos dispersos y de LexoRank — sin agotamiento de huecos ni rebalanceos.
 *
 * No muta la entrada.
 */
export function reorder(columnIds: number[], movedId: number, toIndex: number): number[] {
  const without = columnIds.filter((id) => id !== movedId);
  const index = Math.max(0, Math.min(toIndex, without.length));
  return [...without.slice(0, index), movedId, ...without.slice(index)];
}

/**
 * Posición en la que entra un ítem recién creado: al final de su propia banda de
 * prioridad, justo antes del primer ítem de prioridad inferior. Un ALTA nuevo
 * aterriza sobre los MEDIA; un BAJA, al fondo.
 *
 * Evita que un ALTA nuevo nazca debajo de todos los BAJA, que es la
 * contradicción más obvia de tener orden manual y prioridad a la vez.
 */
export function insertionIndex(
  columnPriorities: WorkItemPriority[],
  priority: WorkItemPriority,
): number {
  const rank = PRIORITY_RANK[priority];
  const firstLower = columnPriorities.findIndex((p) => PRIORITY_RANK[p] > rank);
  return firstLower === -1 ? columnPriorities.length : firstLower;
}
