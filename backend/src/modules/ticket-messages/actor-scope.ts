import { Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { sameId } from '../../common/ids';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketsRepository } from '../tickets/tickets.repository';
import { ActorIds, TicketActor, resolveActorIds } from '../tickets/domain/ticket-actor';

/**
 * Quién actúa sobre el hilo de un ticket y hasta dónde llega.
 *
 * Vive aparte de los dos servicios que lo usan --el del hilo y el de adjuntos--
 * por el mismo motivo que `sameId` vive en `common/ids.ts`: **es la
 * comprobación de pertenencia**, y tener dos copias es tener dos reglas, de las
 * cuales la que se olvide de actualizar es la que deja leer los tickets de otra
 * empresa. Un adjunto y un mensaje se acotan exactamente igual, así que se
 * acotan con el mismo código.
 *
 * No está en `domain/` a propósito: ahí solo hay lógica pura sin DI (ver
 * `domain/attachment-rules.ts`), y `loadVisibleTicketOrFail` consulta el
 * repositorio de tickets.
 */

/**
 * Identificador tal y como puede llegar del código que lo leyó: TypeORM hidrata
 * **toda** columna `bigint` como cadena aunque la entidad la declare `number`.
 * Se acepta como venga y no se compara nunca contra un número con `===`; para
 * escribir se usa siempre el `id` de la fila ya cargada, que es el mismo valor
 * que la propia base devolvió, y para comparar, `sameId`.
 */
export type Id = number | string;

/**
 * El actor del hilo. Igual que `TicketActor`, pero el de cliente **tiene que
 * traer también su `clientId`**.
 *
 * No es un adorno: es lo único que separa a una empresa de otra. Sin él, un
 * usuario del portal podría escribir en el hilo de cualquier `ticketId` y leer
 * los mensajes públicos --o descargar los adjuntos-- del ticket de otra empresa
 * a base de probar números. En el portal sale del token igual que el
 * `clientUserId` (ver `ClientJwtStrategy` y `portal-tickets.controller.ts`),
 * nunca del cuerpo, la URL ni la query.
 *
 * Las dos variantes se sacan de `TicketActor` con `Extract` para no redeclarar
 * la unión y para que el `clientId` sea lo **único** que añade este módulo.
 * Ojo con lo que eso no garantiza: un tercer `kind` añadido a `TicketActor`
 * quedaría fuera de este tipo en silencio, sin romper la compilación de este
 * fichero. Quien falla cerrado en ese caso es `resolveActorIds`, por su guardia
 * `never`, en tiempo de ejecución.
 */
export type TicketMessageActor =
  | Extract<TicketActor, { kind: 'STAFF' }>
  | (Extract<TicketActor, { kind: 'CLIENT' }> & { clientId: number });

/**
 * A qué empresa queda acotado quien actúa.
 *
 * Es una unión y no un `number | null` a propósito. Con `null` valiendo a la
 * vez "es del equipo, lo ve todo" y "no vino ningún `clientId`", el guardia de
 * pertenencia se **desactivaba solo** cuando le faltaba el dato: un actor de
 * cliente con `clientId` nulo se saltaba la comprobación entera y volvía a leer
 * y escribir en cualquier empresa. Lo que decide si hay que acotar es el `kind`
 * del actor, no la presencia del valor, y así queda escrito en el tipo.
 */
export type ClientScope = { restricted: false } | { restricted: true; clientId: number };

/** El actor ya resuelto: sus columnas de autor y a qué empresa se limita. */
export interface ActorScope {
  ids: ActorIds;
  scope: ClientScope;
}

/**
 * El cuerpo del 404 de un ticket, uno solo para todos los casos.
 *
 * Un ticket de otra empresa y un ticket inexistente dan el **mismo** error y el
 * mismo cuerpo: un 403 confirmaría que el id existe y dejaría enumerar los
 * tickets de las demás empresas a base de probar números (spec §4, regla 2).
 * Es una constante y no un literal repetido para que no puedan divergir.
 */
export const TICKET_NOT_FOUND = { code: 'NOT_FOUND', message: 'Ticket no encontrado' } as const;

/**
 * Reparte el actor y calcula su ámbito, o se niega a seguir.
 *
 * `resolveActorIds` es quien falla cerrado ante un `kind` no contemplado -- el
 * mismo guardia `never` que usa el alta del ticket -- así que a partir de ahí
 * el `kind` es uno de los dos conocidos.
 */
export function resolveScope(actor: TicketMessageActor, sujeto: string): ActorScope {
  const ids = resolveActorIds(actor, sujeto);
  if (actor.kind !== 'CLIENT') return { ids, scope: { restricted: false } };
  return { ids, scope: { restricted: true, clientId: assertClientScope(actor.clientId) } };
}

/**
 * El `clientId` de un actor de cliente, o se rechaza la petición sin consultar.
 *
 * Un actor de cliente sin empresa utilizable es un fallo de programación o un
 * token manipulado, y en los dos casos lo correcto es lanzar, nunca degradar a
 * "lo ve todo": el dato que falta es justo el que separa a una empresa de otra.
 * Mismo criterio y mismo cuerpo que `assertSessionScope` en
 * `portal-tickets.service.ts`. Quien construye el actor es el controlador del
 * portal, y `ClientJwtStrategy` copia el `clientId` del payload del token sin
 * validarlo, así que la frontera no puede darlo por bueno.
 */
function assertClientScope(clientId: unknown): number {
  if (typeof clientId === 'number' && Number.isInteger(clientId) && clientId > 0) return clientId;

  // Qué llegó va al log, nunca a la respuesta: el cuerpo se queda en el
  // `{ code, message }` de siempre.
  new Logger('TicketMessagesScope').error(
    `Actor de cliente sin clientId utilizable (${String(clientId)}): se rechaza la petición sin consultar.`,
  );
  throw new UnauthorizedException({
    code: 'UNAUTHORIZED',
    message: 'La sesión no identifica a ninguna empresa.',
  });
}

/**
 * Si quien pregunta puede ver ese ticket. No lanza: lo usa quien tiene que
 * responder con **otro** cuerpo de 404 -- la descarga de un adjunto contesta
 * «Adjunto no encontrado» también cuando el ticket es ajeno, porque el sujeto
 * de la pregunta era el adjunto.
 *
 * `sameId` compara **por valor** porque TypeORM devuelve los `bigint` como
 * cadena: con `===`, el `clientId` del token -- un número de verdad -- nunca
 * igualaría al de la base y el dueño legítimo se comería un 404. Y falla
 * cerrado por el otro lado: un ticket sin cliente (`clientId` nulo) da `false`.
 *
 * Que haya que acotar lo dice `scope.restricted`, que sale del `kind` del
 * actor. Nunca la presencia de un valor: un guardia que se apaga solo cuando le
 * falta el dato no es un guardia.
 */
export function ticketIsVisible(ticket: Ticket | null | undefined, scope: ClientScope): boolean {
  if (!ticket) return false;
  return !scope.restricted || sameId(ticket.clientId, scope.clientId);
}

/**
 * El ticket que quien pregunta puede ver, o 404 -- el mismo para lo ajeno y lo
 * inexistente, desde el mismo `throw`. Es la misma regla, y la misma
 * comparación `sameId`, que usa `PortalTicketsService.detail`.
 */
export async function loadVisibleTicketOrFail(
  tickets: TicketsRepository,
  ticketId: Id,
  scope: ClientScope,
): Promise<Ticket> {
  const ticket = await tickets.findById(ticketId as number);
  if (!ticketIsVisible(ticket, scope)) {
    throw new NotFoundException(TICKET_NOT_FOUND);
  }
  return ticket!;
}
