/**
 * A que ticket pertenece un correo entrante. Dominio puro: no consulta la
 * base ni sabe nada del transporte. Quien llama ya resolvio `byMessageId` y
 * `byCode` con lo que encontro en la base para los identificadores de
 * cabecera y el codigo del asunto, respectivamente; este modulo solo decide
 * que hacer con lo que encontro.
 *
 * Es el modulo con mas peso de seguridad del proyecto: decide si un correo
 * entrante puede escribir en el ticket de otra empresa.
 */

import { sameId } from '../../../common/ids';
import { extractTicketCode, parseMessageIds } from './message-headers';

/**
 * Un ticket ya localizado por el repositorio, junto a la empresa dueña.
 *
 * `ticketId` y `clientId` se aceptan como `unknown` y no como `number`,
 * aunque asi los describa el contrato: son columnas `bigint`, y TypeORM las
 * hidrata **siempre** como cadena por mucho que la entidad las declare
 * `number` (ver `common/ids.ts`). Tiparlas `number` aqui seria repetir la
 * mentira que ese modulo ya existe para no repetir, y dejaria que un
 * `clientId: '7'` de verdad se comparase alguna vez con `===` sin que el
 * compilador se quejara.
 */
interface TicketMatch {
  ticketId: unknown;
  clientId: unknown;
}

export interface CorrelationInput {
  inReplyTo: string | null;
  references: string | null;
  subject: string | null;
  /** Tickets que el repositorio encontro para esos identificadores. */
  byMessageId: TicketMatch[];
  /** Ticket que el repositorio encontro por el codigo del asunto, si lo habia. */
  byCode: TicketMatch | null;
  /**
   * Empresa del remitente, ya resuelta -- pero por la misma razon que
   * `TicketMatch`, no `number`: quien la resuelve puede arrastrar el mismo
   * valor de una columna `bigint` sin haberlo convertido.
   */
  senderClientId: unknown;
}

/**
 * `SIN_REFERENCIA` y `REFERENCIA_NO_RESUELTA` no son el mismo "no": el primero
 * es que el correo no traia ninguna referencia (ni cabecera ni codigo en el
 * asunto). El segundo es que si traia una -- una cabecera con identificador,
 * o un codigo entre corchetes -- pero esa referencia no aterrizo en ningun
 * ticket, o aterrizo en mas de uno sin forma de elegir. Confundirlos decide
 * por la ausencia del **resultado** (`byMessageId`/`byCode` vacios) en vez
 * de por el hecho que lo explica (¿el correo traia algo que resolver?), y
 * esconde justo la señal que delataria a alguien sondeando identificadores
 * ajenos: una rafaga de esos correos se veria igual que trafico nuevo
 * corriente si todo cayera en `SIN_REFERENCIA`.
 */
export type CorrelationResult =
  | { kind: 'HILO'; ticketId: number; via: 'CABECERA' | 'ASUNTO' }
  | {
      kind: 'NUEVO';
      reason: 'SIN_REFERENCIA' | 'REFERENCIA_NO_RESUELTA' | 'REFERENCIA_DE_OTRA_EMPRESA';
    };

/**
 * Decide si el ticket que se encontro pertenece al remitente. Compara con
 * `sameId` y no con `===` ni con `==`: `clientId` llega de una columna
 * `bigint` de TypeORM, hidratada como cadena aunque el tipo diga `number`.
 * Con `===`, un `clientId: '7'` de la base nunca igualaria a un
 * `senderClientId: 7` resuelto en memoria, y el dueño legitimo de un ticket
 * recibiria "de otra empresa" en cada respuesta -- una alarma de seguridad
 * falsa en masa. Con `==`, en cambio, `null == undefined` es cierto, asi que
 * un ticket sin empresa se emparejaria con un remitente sin empresa
 * resuelta: la fuga por el otro lado. `sameId` falla cerrado en los dos
 * sentidos.
 */
function belongsToSender(match: TicketMatch, senderClientId: unknown): boolean {
  return sameId(match.clientId, senderClientId);
}

/**
 * Los tickets distintos entre los resultados, comparando por `sameId` y no
 * por igualdad de cadena: el mismo ticket puede llegar hidratado en dos
 * formas (numero y cadena) segun cual de los identificadores de la cabecera
 * lo encontro, y eso no lo convierte en dos tickets.
 */
function distinctTickets(matches: TicketMatch[]): TicketMatch[] {
  const distinct: TicketMatch[] = [];
  for (const match of matches) {
    if (!distinct.some((seen) => sameId(seen.ticketId, match.ticketId))) {
      distinct.push(match);
    }
  }
  return distinct;
}

/**
 * Correlaciona un correo entrante con un ticket existente, o decide que hace
 * falta uno nuevo.
 *
 * El orden de las dos fuentes no es una preferencia, es la regla de
 * seguridad: **las cabeceras deciden solas en cuanto aportan algo**, y no se
 * complementan mirando el asunto pase lo que pase con ellas -- ni cuando no
 * resuelven ningun ticket, ni cuando resuelven a mas de uno, ni cuando
 * resuelven a uno ajeno. No es que `In-Reply-To` o `References` sean
 * infalsificables: cualquiera escribe la cabecera que quiera, y los
 * identificadores de nuestros propios envios salen de la empresa en cuanto
 * alguien reenvia un correo del ticket. Lo que las hace decidir solas es que
 * son un canal **mas especifico** que el asunto: identifican un mensaje
 * concreto de una conversacion, mientras que el asunto solo repite un numero
 * de unas pocas cifras que cualquiera teclea a mano -- de ahi que la
 * comprobacion de empresa (`belongsToSender`) sea la misma en las dos rutas,
 * y sea ella, no la procedencia de la cabecera, quien de verdad sostiene la
 * frontera. Si tras decidir por cabecera se siguiera mirando el asunto como
 * alternativa, bastaria una cabecera que no resuelva nada (o que resuelva a
 * un ticket ajeno) acompañada del numero correcto en el asunto para colarse
 * en el ticket de otra empresa -- exactamente la puerta que la regla del
 * asunto existe para cerrar. Por eso cada rama termina en un `return` y
 * ninguna sigue a la comprobacion del asunto.
 *
 * La puerta de la rama de cabecera es si el correo **traia** un
 * identificador (`parseMessageIds` sobre las dos cabeceras, de verdad leidas
 * aqui) y no si `byMessageId` vino con algo: una cabecera que no resolvio
 * ningun ticket sigue siendo una cabecera, y tiene que contar como
 * referencia no resuelta, no colarse como si el correo no hubiera traido
 * ninguna.
 */
export function correlate(input: CorrelationInput): CorrelationResult {
  const headerIds = [...parseMessageIds(input.inReplyTo), ...parseMessageIds(input.references)];

  if (headerIds.length > 0) {
    if (input.byMessageId.length === 0) {
      // Habia cabecera, pero ningun ticket la reconoce.
      return { kind: 'NUEVO', reason: 'REFERENCIA_NO_RESUELTA' };
    }

    const candidates = distinctTickets(input.byMessageId);
    if (candidates.length > 1) {
      // Ambiguo: la misma politica que `extractTicketCode` ante dos codigos
      // en el asunto. Acertar por casualidad cual de los dos hilos es el
      // correcto es peor que abrir uno nuevo, que es lo que pasa tambien si
      // no se hubiera encontrado ninguno.
      return { kind: 'NUEVO', reason: 'REFERENCIA_NO_RESUELTA' };
    }

    const [match] = candidates;
    return belongsToSender(match, input.senderClientId)
      ? { kind: 'HILO', ticketId: Number(match.ticketId), via: 'CABECERA' }
      : { kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' };
  }

  // Sin cabecera, solo queda el asunto -- y el asunto es adivinable, asi que
  // el ticket que encuentre tiene que ser del propio remitente para contar.
  const subjectCode = input.subject !== null ? extractTicketCode(input.subject) : null;
  if (subjectCode !== null) {
    if (input.byCode === null) {
      // Habia codigo en el asunto, pero ningun ticket tiene ese codigo.
      return { kind: 'NUEVO', reason: 'REFERENCIA_NO_RESUELTA' };
    }

    return belongsToSender(input.byCode, input.senderClientId)
      ? { kind: 'HILO', ticketId: Number(input.byCode.ticketId), via: 'ASUNTO' }
      : { kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' };
  }

  return { kind: 'NUEVO', reason: 'SIN_REFERENCIA' };
}
