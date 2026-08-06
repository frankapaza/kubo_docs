import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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
    });
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
   * mensaje del que cuelga (`message_id`), y un adjunto sin mensaje (subido al
   * crear el ticket) siempre es visible -- nadie puede subirlo como nota
   * interna antes de que exista el ticket. Por eso, cuando no se piden las
   * notas internas, la condición es "sin mensaje, o con un mensaje PUBLICA":
   * un `LEFT JOIN` con `ticket_messages` resuelto en el propio `WHERE`, no un
   * filtro posterior en memoria sobre el resultado ya traído.
   */
  listAttachments(ticketId: Id, { includeInternal }: VisibilityFilter): Promise<TicketAttachment[]> {
    const qb = this.attachments
      .createQueryBuilder('att')
      .where('att.ticket_id = :ticketId', { ticketId })
      .orderBy('att.created_at', 'ASC')
      .addOrderBy('att.id', 'ASC');

    if (!includeInternal) {
      qb.leftJoin(TicketMessage, 'msg', 'msg.id = att.message_id').andWhere(
        '(att.message_id IS NULL OR msg.visibility = :visibility)',
        { visibility: PUBLIC_VISIBILITY },
      );
    }

    return qb.getMany();
  }

  /**
   * Bytes ya ocupados por los adjuntos de un ticket, **contando también las
   * notas internas**: el disco que ocupa un fichero no distingue quién lo
   * subió, así que la suma no puede fingir que las notas internas no pesan.
   *
   * Este método no decide ningún tope. `MAX_TICKET_BYTES`
   * (`../domain/attachment-rules.ts`) aplica **solo** a lo que sube el
   * cliente, y aplicar ese reparto exige saber quién subió cada fichero --
   * algo que esta suma agregada no distingue y no debe fingir que distingue.
   * Es la capa de servicio quien debe sumar aparte lo de origen cliente contra
   * ese tope; quien llame aquí y lo compare directo contra `MAX_TICKET_BYTES`
   * estaría cortando también las subidas del equipo, que no tienen tope.
   */
  async sumBytes(ticketId: Id): Promise<number> {
    const row = await this.attachments
      .createQueryBuilder('att')
      .select('COALESCE(SUM(att.size_bytes), 0)', 'total')
      .where('att.ticket_id = :ticketId', { ticketId })
      .getRawOne<{ total: string }>();

    return Number(row?.total ?? 0);
  }

  /**
   * Bytes que ocupan en un ticket **solo los adjuntos que subió el cliente**.
   * Es la suma contra la que se compara `MAX_TICKET_BYTES`, que por diseño no
   * afecta al equipo (ver el comentario de esa constante).
   *
   * El reparto va en el `WHERE`, no restando después: `sumBytes` menos «lo del
   * equipo» exigiría dos consultas que pueden verse en instantes distintos, y
   * cualquier fila con las dos columnas de subida nulas -- que el esquema
   * admite -- se contaría al cliente. Aquí solo suma quien tiene
   * `uploaded_by_client_user_id`, que es exactamente la definición del tope.
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
