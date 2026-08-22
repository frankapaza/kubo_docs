/**
 * A que ticket pertenece un correo entrante. Dominio puro: no consulta la
 * base ni sabe nada del transporte. Quien llama ya resolvio `byMessageId` y
 * `byCode` con lo que encontro en la base para los identificadores de
 * cabecera y el codigo del asunto, respectivamente.
 *
 * Es el modulo con mas peso de seguridad del proyecto: decide si un correo
 * entrante puede escribir en el ticket de otra empresa.
 */

import { sameId } from '../../../common/ids';

/** Un ticket ya localizado por el repositorio, junto a la empresa dueña. */
interface TicketMatch {
  ticketId: number;
  clientId: number;
}

export interface CorrelationInput {
  inReplyTo: string | null;
  references: string | null;
  subject: string | null;
  /** Tickets que el repositorio encontro para esos identificadores. */
  byMessageId: TicketMatch[];
  /** Ticket que el repositorio encontro por el codigo del asunto, si lo habia. */
  byCode: TicketMatch | null;
  /** Empresa del remitente, ya resuelta. */
  senderClientId: number;
}

export type CorrelationResult =
  | { kind: 'HILO'; ticketId: number; via: 'CABECERA' | 'ASUNTO' }
  | { kind: 'NUEVO'; reason: 'SIN_REFERENCIA' | 'REFERENCIA_DE_OTRA_EMPRESA' };

/**
 * Decide si el ticket que se encontro pertenece al remitente. Compara con
 * `sameId` y no con `===` porque `clientId` llega de una columna `bigint` de
 * TypeORM, hidratada como cadena aunque el tipo diga `number`: comparar con
 * `===` haria que el dueño legitimo de un ticket recibiera "de otra
 * empresa", o -- si el error fuera al reves -- que una empresa distinta
 * escribiera en un hilo ajeno.
 */
function belongsToSender(match: TicketMatch, senderClientId: number): boolean {
  return sameId(match.clientId, senderClientId);
}

/**
 * Correlaciona un correo entrante con un ticket existente, o decide que hace
 * falta uno nuevo.
 *
 * El orden de las dos fuentes no es una preferencia, es la regla de
 * seguridad: **las cabeceras deciden solas cuando existen**. `In-Reply-To` y
 * `References` los pone el propio servidor de correo del cliente al
 * responder, no se pueden falsificar sin acceso al hilo real -- por eso, si
 * hay resultados por cabecera, esa respuesta es definitiva y no se
 * complementa mirando el asunto. El numero de ticket en el asunto, en
 * cambio, lo escribe cualquiera a mano: es adivinable. Si tras decidir por
 * cabecera se siguiera mirando el asunto como alternativa, bastaria una
 * cabecera basura (que no encuentra nada) acompañada del numero correcto en
 * el asunto para colarse en el ticket de otra empresa -- exactamente la
 * puerta que la regla del asunto existe para cerrar. Por eso cada rama
 * termina en un `return`: ninguna seguida por la siguiente comprobacion.
 */
export function correlate(input: CorrelationInput): CorrelationResult {
  if (input.byMessageId.length > 0) {
    // Hay cabecera con resultado: la cabecera manda, punto. No se mira el
    // asunto ni aunque el ticket no sea del remitente.
    const own = input.byMessageId.find((match) => belongsToSender(match, input.senderClientId));
    if (own) return { kind: 'HILO', ticketId: own.ticketId, via: 'CABECERA' };
    return { kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' };
  }

  if (input.byCode !== null) {
    // Sin cabecera, solo queda el asunto -- y el asunto es adivinable, asi
    // que el ticket encontrado tiene que ser del propio remitente.
    if (belongsToSender(input.byCode, input.senderClientId)) {
      return { kind: 'HILO', ticketId: input.byCode.ticketId, via: 'ASUNTO' };
    }
    return { kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' };
  }

  return { kind: 'NUEVO', reason: 'SIN_REFERENCIA' };
}
