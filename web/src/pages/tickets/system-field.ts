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
