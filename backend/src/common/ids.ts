/**
 * Comparación de identificadores por valor.
 *
 * Vive en `common/` y no dentro de un módulo porque es **la** comprobación de
 * pertenencia que sostiene la regla del 404: la usan el portal de clientes
 * (`PortalTicketsService`, que la reexporta por compatibilidad) y el hilo de
 * mensajes (`TicketMessagesService`). Tener dos copias sería tener dos reglas
 * de pertenencia, y la que se olvide de actualizar es la que deja leer los
 * tickets de otra empresa.
 */

/**
 * Compara dos identificadores por valor.
 *
 * Obligatorio, no defensivo: TypeORM hidrata **toda** columna `bigint` como
 * cadena aunque la entidad la declare `number` (comprobado contra la base:
 * `Ticket.id`, `clientId`, `systemId`, `createdByClientUserId`,
 * `ClientSystem.id`, `ClientUser.id` salen todos como `"13"`, `"1"`…). El
 * tipo de TypeScript miente, así que `===` entre un id del token —un número
 * de verdad— y un id de la base es siempre falso. Con la comparación estricta,
 * el dueño legítimo de un ticket se comería un 404.
 *
 * Los `tinyint` (`isActive`, `isAdmin`, `slaAtRisk`) sí llegan como número; no
 * necesitan este tratamiento.
 *
 * Simétrica a propósito: guardar solo el primer argumento dejaba `Number(null)`
 * → `0` y `Number(undefined)` → `NaN` entrando por el segundo, de modo que un
 * "no hay valor" se convertía en un id comparable. Es la comprobación de la que
 * cuelga la regla del 404 y no debe depender de quién la llame.
 */
export function sameId(a: unknown, b: unknown): boolean {
  const na = toComparableId(a);
  const nb = toComparableId(b);
  return na !== null && nb !== null && na === nb;
}

/**
 * Un identificador comparable, o `null` si el valor no es uno. Fuera quedan
 * `null`, `undefined`, la cadena vacía (que `Number` convertiría en 0) y todo
 * lo que no dé un número finito.
 */
function toComparableId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
