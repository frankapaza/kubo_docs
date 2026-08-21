import { Logger, UnauthorizedException } from '@nestjs/common';

/**
 * Utilidades de frontera compartidas por los servicios del portal
 * (`PortalTicketsService`, `PortalRequirementsService`, y los que vengan).
 *
 * Vivían dentro de `portal-tickets.service.ts` porque fue el primer servicio
 * del portal, pero la regla que aplican —fallar cerrado ante una sesión sin
 * empresa utilizable— no es suya: es de cualquier lectura o escritura que el
 * portal acote por `clientId`. Tenerlas en dos copias sería tener dos
 * fronteras, y la que alguien olvide actualizar es la que deja pasar una
 * consulta sin filtro.
 */

/**
 * Exige que el identificador de la sesión sea un entero positivo antes de
 * usarlo para acotar nada.
 *
 * No es paranoia: los repositorios que filtran por `clientId` suelen montar
 * el `WHERE` con `if (filters.clientId) …`, así que un `clientId` falsy
 * —`0`, `NaN`, `undefined`— **hace desaparecer el filtro** y la consulta
 * devuelve filas de todas las empresas. Esos repositorios los comparte el
 * panel interno, donde "sin filtro de cliente" es una consulta legítima, así
 * que la forma de fallo no se corrige allí: se corrige aquí, que es donde
 * importa. El portal falla cerrado.
 *
 * Hoy el valor no puede llegar mal —las columnas de sesión son `bigint
 * unsigned NOT NULL` y el secreto propio del portal impide que un token del
 * personal valide aquí— pero la frontera no debe depender de eso.
 *
 * `servicio` nombra al llamador en el log (antes era siempre
 * `PortalTicketsService.name`, fijo, porque vivía dentro de esa clase); cada
 * servicio del portal pasa el suyo para que el log siga señalando el sitio
 * correcto.
 */
export function assertSessionScope(
  value: number,
  campo: 'clientId' | 'clientUserId',
  servicio: string,
): void {
  if (Number.isInteger(value) && value > 0) return;

  // Qué campo falló va al log, nunca a la respuesta: el cuerpo se queda en el
  // `{ code, message }` de siempre. Si esto salta, es un fallo de programación
  // o un token manipulado, y en ambos casos interesa verlo en el servidor.
  new Logger(servicio).error(
    `Sesión de portal sin ${campo} utilizable (${String(value)}): se rechaza la petición sin consultar.`,
  );
  throw new UnauthorizedException({
    code: 'UNAUTHORIZED',
    message: 'La sesión no identifica a ninguna empresa.',
  });
}

/** Normaliza una fecha (Date o cadena) al ISO que publica el portal, o `null`. */
export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
