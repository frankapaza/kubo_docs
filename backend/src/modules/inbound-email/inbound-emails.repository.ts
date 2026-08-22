import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';

import { InboundEmail } from './entities/inbound-email.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketEvent } from '../tickets/entities/ticket-event.entity';
import { isUsableId, sameId } from '../../common/ids';

@Injectable()
export class InboundEmailsRepository {
  constructor(
    @InjectRepository(InboundEmail) private readonly repo: Repository<InboundEmail>,
    @InjectRepository(Ticket) private readonly ticketsRepo: Repository<Ticket>,
    @InjectRepository(TicketEvent) private readonly eventsRepo: Repository<TicketEvent>,
  ) {}

  /**
   * Busca por `message_id`, la columna `ascii` que sostiene la clave única de
   * la idempotencia.
   *
   * **`messageId` tiene que llegar ya normalizado**, es decir, pasado por
   * `normalizeMessageId` (`./message-id.ts`) -- el mismo valor que se guarda
   * en la columna, nunca el `Message-ID` crudo tal cual trae la cabecera del
   * correo (que puede no ser ASCII, RFC 6532). Llamar aquí con el valor crudo
   * de un identificador no-ASCII no encuentra el duplicado y rompe la
   * idempotencia de la ingesta -- que es lo único que impide crear un ticket
   * repetido si el proceso cae a medio procesar un correo.
   */
  findByMessageId(messageId: string): Promise<InboundEmail | null> {
    return this.repo.findOne({ where: { messageId } });
  }

  /** Inserta el registro del correo. Un `INSERT` por correo, se procese como se procese. */
  record(row: Partial<InboundEmail>): Promise<InboundEmail> {
    return this.repo.save(this.repo.create(row));
  }

  /**
   * Corrige una fila ya insertada -- nunca un segundo `INSERT` para el mismo
   * correo, que la clave única de `message_id` rechazaría.
   *
   * La usa `InboundEmailService` en dos momentos, los dos para cerrar la
   * ventana de atomicidad entre escribir el ticket (o el mensaje) y dejar
   * constancia de él: la fila se inserta **antes** de crear el ticket, con el
   * resultado que se espera y `ticketId: null` si todavía no existe, y esta
   * función la corrige después -- con el `ticketId` real si todo salió bien,
   * o con `outcome: 'ERROR'` si no. Así, si el proceso muere entre medias, un
   * reinicio encuentra la fila ya reclamada (`findByMessageId` no da `null`)
   * y no repite el correo -- se pierde ese correo en vez de duplicar el
   * ticket, que es el cambio que pide la ronda de correcciones 1: duplicar
   * significa un segundo acuse al mismo cliente.
   */
  async updateOutcome(id: number, patch: Partial<InboundEmail>): Promise<void> {
    await this.repo.update(id, patch);
  }

  findTicketByCode(code: string): Promise<Ticket | null> {
    return this.ticketsRepo.findOne({ where: { code } });
  }

  /**
   * El ticket (y su empresa) al que corresponde cada uno de estos
   * Message-ID, buscando en **dos sitios a la vez**: `tickets.email_message_id`
   * (el correo que abrió el hilo) y `ticket_events.sent_message_id` (cada
   * aviso posterior que se envió). Un cliente contesta igual de a menudo al
   * acuse inicial que a cualquier aviso de después, así que dejar fuera
   * cualquiera de las dos columnas perdería la correlación de esas
   * respuestas.
   *
   * Tres búsquedas como mucho, nunca un JOIN: `tickets` y `ticket_events`
   * pertenecen a repositorios de TypeORM distintos, así que combinarlas en
   * una sola consulta pediría SQL a mano por cada camino de esta función. La
   * tercera búsqueda solo se dispara para los ids de ticket que la primera no
   * cubrió ya.
   *
   * **Solo entran los tickets con `clientId`.** Un ticket sin empresa no
   * tiene a quién atribuirle la respuesta del cliente — la firma de retorno
   * lo exige (`clientId: number`, no `number | null`) precisamente por eso.
   *
   * **`messageIds` tiene que llegar ya normalizado**, igual que en
   * `findByMessageId`: son los dos valores extraídos de `In-Reply-To` /
   * `References` de la respuesta entrante, y esas cabeceras pueden traer el
   * mismo `Message-ID` no-ASCII con el que se abrió el ticket o se envió el
   * aviso. Sin pasarlos por `normalizeMessageId` primero, la búsqueda contra
   * estas dos columnas `ascii` no encuentra nunca el ticket.
   */
  async findTicketsByEmailMessageIds(
    messageIds: string[],
  ): Promise<Array<{ ticketId: number; clientId: number }>> {
    // `In([])` genera `IN ()`, SQL inválido; y de todos modos no hay nada que
    // correlacionar si no llegó ningún Message-ID de referencia.
    if (messageIds.length === 0) return [];

    const abiertoPor = await this.ticketsRepo.find({ where: { emailMessageId: In(messageIds) } });

    const avisosCoincidentes = await this.eventsRepo.find({
      where: { sentMessageId: In(messageIds) },
    });
    const idsPorAviso: Array<number | string> = [];
    for (const evento of avisosCoincidentes) {
      const yaCubierto =
        abiertoPor.some((t) => sameId(t.id, evento.ticketId)) ||
        idsPorAviso.some((id) => sameId(id, evento.ticketId));
      if (!yaCubierto) idsPorAviso.push(evento.ticketId);
    }
    const encontradoPorAviso =
      idsPorAviso.length > 0 ? await this.ticketsRepo.find({ where: { id: In(idsPorAviso) } }) : [];

    return [...abiertoPor, ...encontradoPorAviso]
      .filter((t) => isUsableId(t.clientId))
      .map((t) => ({ ticketId: Number(t.id), clientId: Number(t.clientId) }));
  }

  /** Tope global: cuántos correos de remitente desconocido se descartaron desde `since`. */
  countRepliesToUnknown(since: Date): Promise<number>;
  /** Tope por remitente: lo mismo, pero acotado a una única dirección. */
  countRepliesToUnknown(address: string, since: Date): Promise<number>;
  /**
   * `maybeSince` solo es opcional en esta firma de implementación porque
   * TypeScript exige que cubra las dos sobrecargas de arriba -- las dos
   * expuestas hacia fuera ya obligan a pasar `since`. Antes de esta guarda,
   * un `as Date` sin comprobar dejaba que un `undefined` real (alguien
   * rompiendo el contrato en tiempo de ejecución, p. ej. con `any`) llegara
   * tal cual a `MoreThanOrEqual`: TypeORM genera `receivedAt >= NULL`, SQL
   * nunca da eso por verdadero, y el `count` volvía 0 en silencio -- un tope
   * que decide "no hay respuestas previas" por la AUSENCIA de `since`, no
   * por el hecho de si de verdad no las hay, es un tope que falla ABIERTO.
   * Se decide por el hecho (¿llegó `since`?) y, si no llegó, se lanza en vez
   * de seguir con un conteo mentiroso.
   */
  countRepliesToUnknown(addressOrSince: string | Date, maybeSince?: Date): Promise<number> {
    if (typeof addressOrSince === 'string') {
      if (maybeSince === undefined) {
        throw new Error('countRepliesToUnknown: falta "since" al consultar por dirección');
      }
      return this.repo.count({
        where: {
          outcome: 'REMITENTE_DESCONOCIDO',
          fromAddress: addressOrSince,
          receivedAt: MoreThanOrEqual(maybeSince),
        },
      });
    }
    return this.repo.count({
      where: { outcome: 'REMITENTE_DESCONOCIDO', receivedAt: MoreThanOrEqual(addressOrSince) },
    });
  }

  /**
   * Tope de tickets nuevos: cuántos ha abierto esta dirección desde `since`.
   * A diferencia de `countRepliesToUnknown`, no tiene variante global -- el
   * riesgo que este tope corta es un remitente concreto en bucle, no la
   * reputación del dominio en conjunto -- así que no hace falta la misma
   * sobrecarga ni, por tanto, el mismo cast sin guarda que corrigió arriba.
   */
  countNewTicketsByAddress(address: string, since: Date): Promise<number> {
    return this.repo.count({
      where: { outcome: 'TICKET_CREADO', fromAddress: address, receivedAt: MoreThanOrEqual(since) },
    });
  }
}
