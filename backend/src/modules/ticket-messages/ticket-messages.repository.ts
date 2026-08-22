import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsSelect, Repository } from 'typeorm';

import { TicketAttachment } from './entities/ticket-attachment.entity';
import { TicketMessage } from './entities/ticket-message.entity';

/**
 * Identificador tal y como puede llegar del código que lo leyó: TypeORM
 * hidrata **toda** columna `bigint` como cadena aunque la entidad la declare
 * `number` (ver `ticket-events.repository.ts`, que ya sufrió esto). Aceptar
 * ambos aquí evita que quien llame tenga que convertir -- y que se le olvide
 * justo en el sitio donde importa.
 */
type Id = number | string;

/**
 * Qué visibilidad puede leer quien pregunta. `includeInternal: false` es el
 * valor seguro: solo lo `PUBLICA`. Lo usan tanto `listByTicket` como
 * `listAttachments` porque un adjunto hereda la visibilidad del mensaje del
 * que cuelga (ver `TicketAttachment`).
 */
export interface VisibilityFilter {
  includeInternal: boolean;
}

const PUBLIC_VISIBILITY = 'PUBLICA';

/**
 * El mensaje tal y como sale de aquí hacia `GET /tickets/:ticketId/messages`:
 * `TicketMessagesService.listThread` devuelve estas entidades en crudo y el
 * controlador las serializa tal cual, igual que `TicketEventsRepository` con
 * `TIMELINE_FIELDS` (ver su comentario, mismo motivo exacto).
 *
 * Sin esta lista blanca, añadir `bodyFull` e `inboundEmailId` a `TicketMessage`
 * (migración 021) los mete en la respuesta sin que nadie lo haya pedido: cada
 * mensaje venido de correo viajaría con su historial citado duplicado --el
 * recortado en `bodyMd` y el completo en `bodyFull`-- en cada carga del hilo,
 * y `bodyFull` es un `MEDIUMTEXT`. El portal se salva porque
 * `PortalMessageView` proyecta campo a campo; el panel no, así que el corte
 * va aquí, en el repositorio, para cubrir a cualquier consumidor futuro sin
 * que tenga que acordarse.
 *
 * Se enumera en positivo y no como una lista de exclusiones, por lo mismo que
 * `TIMELINE_FIELDS`: la columna que se añada dentro de seis meses no debe
 * aparecer sola en la respuesta del panel.
 */
export const THREAD_FIELDS: FindOptionsSelect<TicketMessage> = {
  id: true,
  ticketId: true,
  bodyMd: true,
  visibility: true,
  authorUserId: true,
  authorClientUserId: true,
  createdAt: true,
};

@Injectable()
export class TicketMessagesRepository {
  constructor(
    @InjectRepository(TicketMessage) private readonly messages: Repository<TicketMessage>,
    @InjectRepository(TicketAttachment) private readonly attachments: Repository<TicketAttachment>,
  ) {}

  /**
   * El hilo de un ticket, en orden de llegada.
   *
   * El filtro de visibilidad va en el `WHERE`, nunca en un `.filter()` sobre
   * el resultado: traer las notas internas y descartarlas después es cómo se
   * filtra una vez y se olvida la siguiente, y aquí "la siguiente" es la
   * respuesta que de verdad llega a un cliente.
   */
  listByTicket(ticketId: Id, { includeInternal }: VisibilityFilter): Promise<TicketMessage[]> {
    return this.messages.find({
      where: includeInternal
        ? { ticketId: ticketId as number }
        : { ticketId: ticketId as number, visibility: PUBLIC_VISIBILITY },
      order: { createdAt: 'ASC', id: 'ASC' },
      select: THREAD_FIELDS,
    });
  }

  /**
   * Enlaza un mensaje ya guardado con el correo entrante del que salió
   * (migración 021, `ticket_messages.inbound_email_id`). Se llama **después**
   * de insertar la fila de `inbound_emails` -- que a su vez necesita el id del
   * mensaje o del ticket ya creados --, así que este enlace no puede ir en el
   * mismo `INSERT` que el mensaje: es, a propósito, la última escritura de la
   * ingesta de un correo, puramente informativa (de qué correo salió este
   * mensaje del hilo) y no algo de lo que dependa ningún invariante.
   */
  async attachInboundEmail(messageId: Id, inboundEmailId: number): Promise<void> {
    await this.messages.update(messageId as number, { inboundEmailId });
  }

  /**
   * Un mensaje suelto por su id, **sin filtrar por visibilidad**.
   *
   * Es deliberado: quien pregunta necesita saber si el mensaje es interno para
   * decidir qué hacer -- el equipo cuelga y descarga adjuntos de sus notas
   * internas, y al cliente hay que contestarle 404. Un buscador que devolviera
   * `null` para las internas escondería esa diferencia a los dos por igual. La
   * decisión la toma `TicketAttachmentsService`, que sí sabe quién pregunta.
   */
  findMessage(id: Id): Promise<TicketMessage | null> {
    return this.messages.findOne({ where: { id: id as number } });
  }

  findAttachment(id: Id): Promise<TicketAttachment | null> {
    return this.attachments.findOne({ where: { id: id as number } });
  }

  /**
   * Inserta la fila de un adjunto.
   *
   * `storage_key` es única en el esquema: dos filas con la misma clave dejarían
   * el borrado de una señalando el archivo de la otra. Un `ER_DUP_ENTRY` aquí
   * es, por tanto, un `INSERT` que hay que dejar fallar -- nunca reintentar con
   * la misma clave.
   */
  createAttachment(data: Partial<TicketAttachment>): Promise<TicketAttachment> {
    return this.attachments.save(this.attachments.create(data));
  }

  /**
   * Los adjuntos de un ticket, en orden de llegada.
   *
   * `ticket_attachments` no tiene columna de visibilidad propia: la hereda del
   * mensaje del que cuelga (`message_id`). Cuando no se piden las notas
   * internas, un adjunto existe **solo si existe su mensaje, es de este ticket
   * y es público** -- un `INNER JOIN` con `ticket_messages` resuelto en el
   * propio `WHERE`, no un filtro posterior en memoria sobre el resultado ya
   * traído.
   *
   * La condición era `att.message_id IS NULL OR msg.visibility = 'PUBLICA'`, y
   * esa rama de `NULL` dejaba pasar **siempre** al adjunto que no colgara de
   * ningún mensaje. Se escribió cuando lo único capaz de crear una fila así era
   * el alta del ticket, premisa que dejó de valer con
   * `TicketAttachmentsService.upload`, y que ya no vale de ninguna manera desde
   * que `upload` exige `messageId`. Al cerrarse esa misma rama en la descarga,
   * mantenerla aquí dejaba lo peor de las dos opciones: un adjunto que **salía
   * en la lista del cliente y daba 404 al descargarlo**. Si todo adjunto cuelga
   * de un mensaje, uno que no cuelgue de ninguno es una anomalía y no un
   * adjunto público: para un cliente, no existe.
   *
   * El `INNER JOIN` dice esa regla con la forma de la consulta y no con una
   * condición que haya que leer entera, y de paso hace fallar cerrado a la fila
   * que apunte a un mensaje borrado. La igualdad de `ticket_id` va en el `ON`
   * por el mismo motivo que `TicketAttachmentsService.download` la comprueba
   * con `sameId`: un adjunto que colgara de un mensaje público **de otro
   * ticket** heredaría una visibilidad que nadie eligió. Las dos puertas
   * aplican exactamente la misma condición, así que no pueden discrepar.
   *
   * Para un actor interno no hay `JOIN` ni condición ninguna: al equipo le
   * existe todo, incluidas las anomalías -- que es justo quien tiene que poder
   * verlas.
   */
  listAttachments(ticketId: Id, { includeInternal }: VisibilityFilter): Promise<TicketAttachment[]> {
    const qb = this.attachments
      .createQueryBuilder('att')
      .where('att.ticket_id = :ticketId', { ticketId })
      .orderBy('att.created_at', 'ASC')
      .addOrderBy('att.id', 'ASC');

    if (!includeInternal) {
      qb.innerJoin(
        TicketMessage,
        'msg',
        'msg.id = att.message_id AND msg.ticket_id = att.ticket_id',
      ).andWhere('msg.visibility = :visibility', { visibility: PUBLIC_VISIBILITY });
    }

    return qb.getMany();
  }

  /**
   * Bytes que ocupan en un ticket **solo los adjuntos que subió el cliente**.
   * Es la suma contra la que se compara `MAX_TICKET_BYTES`, que por diseño no
   * afecta al equipo (ver el comentario de esa constante).
   *
   * El reparto va en el `WHERE`, no restando después: sumar el total del ticket
   * y quitarle «lo del equipo» exigiría dos consultas que pueden verse en
   * instantes distintos, y cualquier fila con las dos columnas de subida nulas
   * -- que el esquema admite -- se le contaría al cliente. Aquí solo suma quien
   * tiene `uploaded_by_client_user_id`, que es exactamente la definición del
   * tope.
   *
   * Hubo también un `sumBytes` que sumaba el ticket entero. Se borró al quedarse
   * sin consumidores: era un arma cargada con la etiqueta puesta, porque
   * compararlo contra `MAX_TICKET_BYTES` --lo que su nombre invita a hacer--
   * cortaba también las subidas del equipo, que no tienen tope.
   */
  async sumClientBytes(ticketId: Id): Promise<number> {
    const row = await this.attachments
      .createQueryBuilder('att')
      .select('COALESCE(SUM(att.size_bytes), 0)', 'total')
      .where('att.ticket_id = :ticketId', { ticketId })
      .andWhere('att.uploaded_by_client_user_id IS NOT NULL')
      .getRawOne<{ total: string }>();

    return Number(row?.total ?? 0);
  }
}
