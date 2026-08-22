import { WorkItemStatus } from '../../work-items/domain/work-item-board';
import { PortalRequirementStatusLabel } from '../dto/portal-requirement.dto';

/**
 * Cómo se llama cada estado de requerimiento de cara al cliente.
 *
 * Vivía dentro de `portal-requirements.service.ts` porque fue el único sitio
 * que la necesitaba, pero desde que el informe mensual (tarea 5) también
 * traduce estados de requerimiento, tenerla en dos copias sería tener dos
 * traducciones: la que alguien actualice en un sitio y olvide en el otro es
 * la que hace que el detalle y el informe de un mismo requerimiento se
 * contradigan delante del cliente.
 *
 * `PENDIENTE` significa para la casa «aceptado y en cola», pero un cliente que
 * lee «Pendiente» no lo distingue de «Solicitado» — que es justo la diferencia
 * entre «lo pediste» y «nos comprometimos». El `Record` completo obliga a
 * nombrar aquí cualquier estado nuevo, o deja de compilar.
 */
export const REQUIREMENT_STATUS_LABELS: Record<WorkItemStatus, PortalRequirementStatusLabel> = {
  SOLICITADO: 'Solicitado',
  PENDIENTE: 'Aceptado, en cola',
  EN_PROCESO: 'En desarrollo',
  PRUEBAS: 'En pruebas',
  CERRADO: 'Entregado',
  BLOQUEADO: 'Bloqueado',
  CANCELADO: 'Cancelado',
  RECHAZADO: 'Rechazado',
};
