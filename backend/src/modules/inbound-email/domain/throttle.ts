/**
 * Los topes contra bucles y abuso del correo entrante. Dominio puro: no
 * consulta la base, no manda nada y no sabe qué hacer con un `false` --
 * quien llama ya hizo la consulta que alimenta cada conteo (una por
 * dirección, otra global u otra por hora) y es quien decide el efecto,
 * normalmente descartar sin responder ni crear nada.
 *
 * **Un tope que falla abierto no es un tope.** Por eso ninguna función de
 * aquí lee nada por sí misma: si la consulta que produce un conteo revienta,
 * la responsabilidad de tratar ese fallo como "tope ya alcanzado" es de
 * quien llama (`InboundEmailService`), nunca de este módulo, que ni se
 * entera de que hubo un error. Ver el comentario de
 * `InboundEmailsRepository.countRepliesToUnknown` para el defecto concreto
 * que motivó esta cautela: un valor ausente que, sin guarda, hacía que el
 * conteo diera cero y el tope fallara ABIERTO.
 */

/** Días de enfriamiento antes de volver a responder a la misma dirección desconocida. */
export const UNKNOWN_REPLY_COOLDOWN_DAYS = 7;

/** Tope global: respuestas a remitentes desconocidos, sumando todas las direcciones, en una hora. */
export const UNKNOWN_REPLY_MAX_PER_HOUR = 20;

/** Tope por dirección y hora: tickets nuevos que la misma dirección puede abrir antes de que se le deje de crear más. */
export const NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR = 10;

/**
 * Un conteo usable: un número finito. `NaN`, `Infinity` y `-Infinity` no lo
 * son -- y tampoco lo es un valor que en tiempo de ejecución resulte no ser
 * un número en absoluto (`null`, `undefined`), aunque el tipo declarado diga
 * `number`: TypeScript no vigila el límite entre este módulo y quien lo
 * llama, solo el código que sí pasó por el compilador.
 *
 * Hoy nada produce un valor así -- `repo.count()` de TypeORM siempre da un
 * número --, pero este módulo se declara a sí mismo el guardián de que
 * ningún tope decida por la AUSENCIA de un conteo en vez de por el conteo
 * en sí (ver el comentario de cabecera). Sin esta guarda, un conteo ausente
 * habría colado el mismo defecto que corrigió `countRepliesToUnknown` --
 * solo que aquí, en el punto de decisión, en vez de en el repositorio.
 */
function isUsableCount(value: number): boolean {
  return Number.isFinite(value);
}

export interface ShouldReplyToUnknownInput {
  /**
   * Respuestas ya mandadas a esta dirección dentro de la ventana de
   * enfriamiento (los últimos `UNKNOWN_REPLY_COOLDOWN_DAYS` días). Quien
   * llama es quien acota la consulta a esa ventana -- esta función no sabe
   * de fechas, solo del conteo ya filtrado.
   */
  repliesToAddressInCooldown: number;
  /** Respuestas mandadas a cualquier desconocido en la última hora, sin filtrar por dirección. */
  repliesGlobalLastHour: number;
}

/**
 * Decide si toca responder a un remitente desconocido, o si algún tope ya lo
 * impide.
 *
 * Los dos topes son independientes y **cualquiera de los dos basta para
 * negar la respuesta**: el de dirección corta al desconocido que insiste
 * (o a un autorespondedor mal configurado que contesta cada acuse), y el
 * global protege la reputación del dominio cuando insisten muchos
 * desconocidos a la vez, no solo uno.
 *
 * `repliesToAddressInCooldown > 0` basta por sí solo -- no hace falta
 * compararlo con ningún máximo, la sola presencia de una respuesta previa
 * dentro del enfriamiento ya decide que toca esperar.
 *
 * Si cualquiera de los dos conteos no es un número usable (ver
 * `isUsableCount`), se niega la respuesta -- fallo cerrado, igual que el
 * criterio con el que `InboundEmailService` trata una consulta que revienta.
 * Sin esta guarda, `repliesToAddressInCooldown` ausente habría hecho fallar
 * `> 0` (silenciosamente "no hay historial") y `repliesGlobalLastHour`
 * ausente habría hecho fallar `< UNKNOWN_REPLY_MAX_PER_HOUR` igual de
 * silenciosamente ("tope no agotado") -- las dos comparaciones ceden ante
 * un no-número exactamente en el sentido que abre la puerta.
 */
export function shouldReplyToUnknown(input: ShouldReplyToUnknownInput): boolean {
  if (!isUsableCount(input.repliesToAddressInCooldown) || !isUsableCount(input.repliesGlobalLastHour)) {
    return false;
  }
  if (input.repliesToAddressInCooldown > 0) return false;
  return input.repliesGlobalLastHour < UNKNOWN_REPLY_MAX_PER_HOUR;
}

/**
 * El tope de tickets nuevos por dirección y hora ya se alcanzó con este
 * conteo. No decide nada sobre si el correo en cuestión abriría un ticket
 * nuevo o continuaría uno existente -- esa distinción (`correlate`, en
 * `./correlation.ts`) la hace quien llama, **antes** de preguntar esto: el
 * tope protege contra el correo mal configurado que abre tickets en bucle, y
 * no debe alcanzar nunca a una respuesta que ya correlacionó con un hilo
 * vivo -- ese cliente no tiene por qué quedarse mudo por el defecto de otro.
 *
 * Un conteo no usable (ver `isUsableCount`) se trata como tope YA alcanzado
 * -- fallo cerrado, no se crea el ticket. Es la comparación contraria a la
 * de `shouldReplyToUnknown` (`>=` en vez de `<`), así que un no-número la
 * habría colado del lado opuesto: sin esta guarda, los dos topes fallarían
 * en direcciones distintas ante el mismo tipo de defecto, por pura
 * coincidencia del sentido de cada comparación.
 */
export function hasReachedNewTicketCap(newTicketsFromAddressLastHour: number): boolean {
  if (!isUsableCount(newTicketsFromAddressLastHour)) return true;
  return newTicketsFromAddressLastHour >= NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR;
}
