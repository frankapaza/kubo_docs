import { BadRequestException } from '@nestjs/common';

import { sameId } from '../../../common/ids';

/**
 * La regla del sistema del ticket, entera y en un solo sitio: funciones puras,
 * sin base y sin reloj, que `TicketsService` llama con la lista de asignaciones
 * activas del cliente ya consultada.
 *
 * > Al crear un ticket, si el ticket tiene cliente y ese cliente tiene al menos
 * > un sistema asignado y activo, hay que elegir uno. Si no tiene ninguno, o el
 * > ticket no tiene cliente, el sistema queda opcional.
 *
 * La obligación vive en la aplicación, no en la base: `tickets.system_id` sigue
 * admitiendo vacío. Y no es retroactiva: editar un ticket viejo sin sistema no
 * la aplica (ver `assertSystemBelongsToClient`).
 *
 * El portal conserva además **su** primera barrera
 * (`PortalTicketsService.resolveSystemId`): la frontera entre empresas no se
 * delega en una regla compartida que mañana puede cambiar de motivo.
 */

/**
 * Quién da de alta el ticket, en lo que a esta regla respecta.
 *
 * - `'EXIGIDO'` (por defecto): hay alguien a quien preguntar --el panel, el
 *   portal--, así que si el cliente tiene sistemas, hay que elegir uno.
 * - `'EXENTO_SIN_QUIEN_ELIJA'`: solo la ingesta de correo. Nadie elige nada, y
 *   un correo que no se convierte en ticket es una petición de cliente perdida.
 *
 * **Es un valor nombrado y no una deducción.** No se saca de `origin ===
 * 'EMAIL'` ni de que venga un `emailOrigin`, aunque hoy coincidan: decidir por
 * una consecuencia en vez de por el hecho es el defecto recurrente de este
 * proyecto, y `origin` lo teclea cualquiera en el formulario del panel, así
 * que sería una puerta para saltarse la regla sin querer. Por defecto se
 * exige: un camino de escritura nuevo hereda la regla en vez de saltársela por
 * omisión.
 */
export type SystemRequirement = 'EXIGIDO' | 'EXENTO_SIN_QUIEN_ELIJA';

/**
 * Una asignación activa del cliente. **`id` es el de la ASIGNACIÓN**
 * (`client_systems.id`), no el del producto del catálogo: es lo que guarda
 * `tickets.system_id` y lo que mandan los dos formularios.
 */
export interface ActiveSystem {
  id: number;
}

const ELIGE_SISTEMA = 'Elige el sistema afectado.';
const SISTEMA_AJENO = 'El sistema indicado no es de este cliente o está inactivo.';

/**
 * El `system_id` con el que nace un ticket, o un 400 si no puede nacer así.
 *
 * El orden es parte de la regla: **primero** se valida el sistema elegido --y
 * eso no lo exime la ingesta: un id imposible es un error venga de donde
 * venga--, y **solo si no se eligió ninguno** se decide si hacía falta.
 */
export function resolveTicketSystem(params: {
  requirement: SystemRequirement;
  clientId: number | null | undefined;
  systemId: number | null | undefined;
  activeSystems: ActiveSystem[];
}): number | null {
  const { requirement, clientId, systemId, activeSystems } = params;

  if (systemId !== undefined && systemId !== null) {
    assertSystemBelongsToClient({ systemId, activeSystems });
    return Number(systemId);
  }

  if (requirement === 'EXIGIDO' && clientId && activeSystems.length > 0) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: ELIGE_SISTEMA });
  }
  return null;
}

/**
 * Que un sistema elegido sea una asignación activa del cliente del ticket. Sin
 * sistema no dice nada: es lo que usa la edición, donde la obligación de
 * elegir no es retroactiva.
 *
 * Por `sameId` y no por `===`: los ids que llegan de la base son cadenas.
 */
export function assertSystemBelongsToClient(params: {
  systemId: number | null | undefined;
  activeSystems: ActiveSystem[];
}): void {
  const { systemId, activeSystems } = params;
  if (systemId === undefined || systemId === null) return;
  if (!activeSystems.some((s) => sameId(s.id, systemId))) {
    throw new BadRequestException({ code: 'BAD_INPUT', message: SISTEMA_AJENO });
  }
}

/**
 * El sistema que la ingesta de correo le pone sola a un ticket: el único
 * asignado y activo del cliente, o ninguno.
 *
 * Con uno solo no es una suposición: es el único software que esa empresa nos
 * arrienda, y es lo que anotaría cualquiera que mirara el correo. Con dos o
 * más, adivinar sería inventarse justo el dato que todo esto existe para tener
 * fiable: el ticket entra sin sistema y el equipo lo asigna en el triaje.
 */
export function soleActiveSystemId(activeSystems: ActiveSystem[]): number | null {
  return activeSystems.length === 1 ? Number(activeSystems[0].id) : null;
}
