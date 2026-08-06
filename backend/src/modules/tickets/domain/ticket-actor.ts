import { InternalServerErrorException } from '@nestjs/common';

/**
 * Quién origina la escritura: un miembro del equipo o un usuario del portal de
 * clientes. Las dos columnas del actor -- en `tickets`, en `ticket_events` y en
 * `ticket_messages` -- nunca se ponen a la vez, y nunca quedan las dos nulas:
 * lo decide `kind`, para que la fila nunca quede en un estado ambiguo sobre
 * quién la creó.
 */
export type TicketActor =
  | { kind: 'STAFF'; userId: number }
  | { kind: 'CLIENT'; clientUserId: number };

/** El actor ya repartido en sus dos identificadores. Exactamente uno va puesto. */
export interface ActorIds {
  userId: number | null;
  clientUserId: number | null;
}

/**
 * Reparte el actor en sus dos identificadores, o se niega a escribir.
 *
 * Con los ternarios `actor.kind === 'STAFF' ? … : null` repartidos por varios
 * sitios, un tercer valor de `kind` producía un ticket **y** su evento CREATED
 * con las dos columnas nulas: un ticket sin autor, posible solo desde que la
 * 013 hizo `created_by` nullable, y que ya no se puede atribuir a nadie a
 * posteriori. La invariante la sostenía únicamente la unión de TypeScript, que
 * no existe en tiempo de ejecución: basta un `as any`, un JSON deserializado o
 * una variante nueva sin actualizar el reparto.
 *
 * Vive aquí, y no dentro de un servicio, porque el mismo reparto lo necesitan
 * el alta del ticket (`TicketsService.create`, columnas `created_by` /
 * `created_by_client_user_id`) y el hilo de mensajes
 * (`TicketMessagesService.post`, columnas `author_user_id` /
 * `author_client_user_id`). Duplicar el `switch` es duplicar exactamente el
 * descuido que este `never` viene a impedir.
 *
 * El `never` deja además el descuido en tiempo de compilación: añadir un tercer
 * `kind` a `TicketActor` sin decidir sus columnas no compila.
 *
 * `sujeto` es lo que se lee en el mensaje de error («del ticket», «del
 * mensaje»): quien depure un 500 necesita saber qué escritura se abortó.
 */
export function resolveActorIds(actor: TicketActor, sujeto: string): ActorIds {
  switch (actor.kind) {
    case 'STAFF':
      return { userId: actor.userId, clientUserId: null };
    case 'CLIENT':
      return { userId: null, clientUserId: actor.clientUserId };
    default: {
      const noContemplado: never = actor;
      throw new InternalServerErrorException({
        code: 'INTERNAL',
        message:
          `No se pudo determinar el autor ${sujeto}: tipo de actor no contemplado ` +
          `(${JSON.stringify((noContemplado as { kind?: unknown })?.kind)}).`,
      });
    }
  }
}
