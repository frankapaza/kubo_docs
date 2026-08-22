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
 */
export function shouldReplyToUnknown(input: ShouldReplyToUnknownInput): boolean {
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
 */
export function hasReachedNewTicketCap(newTicketsFromAddressLastHour: number): boolean {
  return newTicketsFromAddressLastHour >= NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR;
}
