/**
 * El campo «Sistema» de los dos diálogos de alta de ticket: el del panel y el
 * del portal.
 *
 * Los textos viven juntos a propósito. Son mensajes distintos para lectores
 * distintos --el cliente, que no puede asignar nada; el equipo, que a veces
 * sí--, y la única forma de revisar que siguen diciendo lo mismo es verlos en
 * la misma pantalla.
 */

/** En qué situación está el campo, y por tanto qué se pinta en su lugar. */
export type SystemFieldState = 'SIN_CLIENTE' | 'CARGANDO' | 'SIN_SISTEMAS' | 'ELEGIBLE';

/**
 * Decide qué se pinta en el sitio del campo.
 *
 * `loaded` existe para que el aviso de «no tiene sistemas» no parpadee en cada
 * apertura mientras la lista viaja: sin él, la lista vacía de antes de cargar
 * se leería como «no hay ninguno», y un aviso que aparece y se va es ruido.
 */
export function systemFieldState(params: {
  hasClient: boolean;
  loaded: boolean;
  count: number;
}): SystemFieldState {
  if (!params.hasClient) return 'SIN_CLIENTE';
  if (!params.loaded) return 'CARGANDO';
  if (params.count === 0) return 'SIN_SISTEMAS';
  return 'ELEGIBLE';
}

export const SIN_SISTEMAS_PORTAL =
  'Tu empresa aún no tiene sistemas registrados. Puedes crear el ticket igualmente; lo clasificaremos nosotros.';
export const SIN_SISTEMAS_PANEL =
  'Este cliente no tiene sistemas asignados. El ticket se puede crear igual, pero queda sin clasificar.';
export const SIN_SISTEMAS_PANEL_ENLACE = 'Asignarle el primero';
export const SIN_SISTEMAS_PANEL_SIN_PERMISO =
  'Pídele a un administrador que le asigne sus sistemas.';

/** La ficha del cliente, abierta ya en su pestaña «Sistemas». */
export function clientSystemsHref(clientId: number): string {
  return `/clients/${clientId}?tab=systems`;
}

/**
 * El rechazo cuando el cliente tiene sistemas y no se eligió ninguno.
 *
 * Es el mismo literal, carácter a carácter, que lanza `resolveTicketSystem` en
 * el backend (`modules/tickets/domain/system-requirement.ts`). Se repite aquí y
 * no se le pide al servidor porque esta guarda existe para que la petición
 * **no** salga; si los dos textos divergieran, el usuario leería dos
 * redacciones del mismo rechazo, que es peor que leer una sola.
 */
export const ELIGE_SISTEMA = 'Elige el sistema afectado.';

/** El `<option>` vacío cuando hay sistemas: no es una elección, es un hueco. */
export const ELIGE_SISTEMA_OPCION = '(elige un sistema)';

/**
 * Cómo se enseña el sistema de un ticket en su ficha.
 *
 * Un sistema desasignado o desactivado **se sigue viendo**, con la marca,
 * porque el ticket viejo conserva su `system_id` y borrar el dato del pasado
 * para que cuadre el presente es falsificar el histórico. Si la lista no trae
 * ese id --porque no cargó, o porque la asignación se quitó-- se cae al número
 * antes que a un guion: un guion diría «este ticket no tiene sistema», que es
 * otra cosa.
 */
export function systemLabel(
  system: { name: string; isActive: number } | undefined,
  systemId: number | null,
): string {
  if (systemId === null) return '—';
  if (!system) return String(systemId);
  return system.isActive === 1 ? system.name : `${system.name} (inactivo)`;
}
