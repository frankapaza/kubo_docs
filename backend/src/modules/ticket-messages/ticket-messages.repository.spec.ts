import { FindManyOptions, FindOneOptions } from 'typeorm';

import { TicketAttachment } from './entities/ticket-attachment.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { TicketMessagesRepository } from './ticket-messages.repository';

/**
 * Como en `ticket-events.repository.spec.ts`: estos tests miran las opciones
 * (o los fragmentos de SQL y sus parámetros) que se le pasan de verdad a
 * TypeORM, no un resultado simulado. El filtro de visibilidad es el que
 * decide si una nota interna se le enseña a un cliente -- si aquí solo se
 * comprobara lo que devuelve un doble, un filtro que desapareciera del
 * `WHERE` pasaría entero por delante de la suite.
 */

/** Doble mínimo de un `SelectQueryBuilder` encadenable: cada método se apunta y devuelve `this`. */
function montarQueryBuilder(resultado: { getMany?: unknown[]; getRawOne?: unknown }) {
  const llamadas: {
    where: unknown[];
    andWhere: unknown[];
    leftJoin: unknown[];
    innerJoin: unknown[];
    select: unknown[];
  } = {
    where: [],
    andWhere: [],
    leftJoin: [],
    innerJoin: [],
    select: [],
  };

  const qb: any = {
    where: jest.fn((...args: unknown[]) => {
      llamadas.where.push(args);
      return qb;
    }),
    andWhere: jest.fn((...args: unknown[]) => {
      llamadas.andWhere.push(args);
      return qb;
    }),
    leftJoin: jest.fn((...args: unknown[]) => {
      llamadas.leftJoin.push(args);
      return qb;
    }),
    innerJoin: jest.fn((...args: unknown[]) => {
      llamadas.innerJoin.push(args);
      return qb;
    }),
    select: jest.fn((...args: unknown[]) => {
      llamadas.select.push(args);
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    getMany: jest.fn().mockResolvedValue(resultado.getMany ?? []),
    getRawOne: jest.fn().mockResolvedValue(resultado.getRawOne),
  };

  return { qb, llamadas };
}

function montar(resultado: { getMany?: unknown[]; getRawOne?: unknown } = {}) {
  const find = jest.fn().mockResolvedValue([]);
  const findOne = jest.fn().mockResolvedValue(null);
  const create = jest.fn((data: unknown) => data);
  const save = jest.fn((data: unknown) => Promise.resolve({ id: 77, ...(data as object) }));
  const { qb, llamadas } = montarQueryBuilder(resultado);
  const createQueryBuilder = jest.fn(() => qb);

  const messagesRepo = { find, findOne } as any;
  const attachmentsRepo = { find, findOne, create, save, createQueryBuilder } as any;

  const repo = new TicketMessagesRepository(messagesRepo, attachmentsRepo);
  return { repo, find, findOne, create, save, createQueryBuilder, qb, llamadas };
}

describe('TicketMessagesRepository', () => {
  describe('listByTicket', () => {
    it('sin includeInternal, filtra por PUBLICA en el propio WHERE', async () => {
      const { repo, find } = montar();

      await repo.listByTicket(13, { includeInternal: false });

      const opciones = find.mock.calls[0][0] as FindManyOptions<TicketMessage>;
      expect(opciones.where).toEqual({ ticketId: 13, visibility: 'PUBLICA' });
    });

    it('con includeInternal, no restringe por visibilidad', async () => {
      const { repo, find } = montar();

      await repo.listByTicket(13, { includeInternal: true });

      const opciones = find.mock.calls[0][0] as FindManyOptions<TicketMessage>;
      expect(opciones.where).toEqual({ ticketId: 13 });
    });

    it('ordena el hilo por llegada: created_at y luego id, ambos ascendentes', async () => {
      const { repo, find } = montar();

      await repo.listByTicket(13, { includeInternal: false });

      const opciones = find.mock.calls[0][0] as FindManyOptions<TicketMessage>;
      expect(opciones.order).toEqual({ createdAt: 'ASC', id: 'ASC' });
    });

    it('acepta el ticketId como cadena, que es como puede llegar de otra fila ya leída', async () => {
      const { repo, find } = montar();

      await repo.listByTicket('13', { includeInternal: false });

      const opciones = find.mock.calls[0][0] as FindManyOptions<TicketMessage>;
      expect((opciones.where as any).ticketId).toBe('13');
    });
  });

  describe('findAttachment', () => {
    it('busca por id sobre el repositorio de adjuntos', async () => {
      const { repo, findOne } = montar();

      await repo.findAttachment(7);

      const opciones = findOne.mock.calls[0][0] as FindOneOptions<TicketAttachment>;
      expect(opciones.where).toEqual({ id: 7 });
    });
  });

  describe('findMessage', () => {
    it('busca por id sobre el repositorio de mensajes', async () => {
      const { repo, findOne } = montar();

      await repo.findMessage(501);

      const opciones = findOne.mock.calls[0][0] as FindOneOptions<TicketMessage>;
      expect(opciones.where).toEqual({ id: 501 });
    });

    /**
     * Sin filtro de visibilidad a propósito: quien pregunta necesita **saber**
     * si el mensaje es interno para decidir (colgar un adjunto, servirlo o
     * negarlo con un 404). Un buscador que devolviera `null` para las notas
     * internas escondería esa diferencia al equipo, que sí las ve.
     */
    it('no filtra por visibilidad: la decide quien llama', async () => {
      const { repo, findOne } = montar();

      await repo.findMessage(501);

      const opciones = findOne.mock.calls[0][0] as FindOneOptions<TicketMessage>;
      expect(opciones.where).not.toHaveProperty('visibility');
    });
  });

  describe('createAttachment', () => {
    it('crea y guarda la fila sobre el repositorio de adjuntos', async () => {
      const { repo, create, save } = montar();

      const fila = await repo.createAttachment({
        ticketId: 13,
        messageId: null,
        filename: 'captura.png',
        storageKey: 'tickets/13/uuid.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
      });

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ storageKey: 'tickets/13/uuid.png' }));
      expect(save).toHaveBeenCalledTimes(1);
      expect(fila.id).toBe(77);
    });
  });

  describe('sumClientBytes', () => {
    /**
     * `MAX_TICKET_BYTES` aplica **solo** a lo que sube el cliente (el equipo no
     * tiene tope), así que el reparto tiene que ir en el `WHERE`: sumar todo y
     * restar después es cómo se acaba cortando también al equipo.
     */
    it('suma solo los adjuntos de origen cliente, en el propio WHERE', async () => {
      const { repo, createQueryBuilder, llamadas } = montar({ getRawOne: { total: '2048' } });

      const total = await repo.sumClientBytes(13);

      expect(createQueryBuilder).toHaveBeenCalledWith('att');
      expect(llamadas.select[0]).toEqual(['COALESCE(SUM(att.size_bytes), 0)', 'total']);
      expect(llamadas.where[0]).toEqual(['att.ticket_id = :ticketId', { ticketId: 13 }]);
      expect(llamadas.andWhere[0]).toEqual(['att.uploaded_by_client_user_id IS NOT NULL']);
      expect(total).toBe(2048);
    });

    it('sin adjuntos de cliente, COALESCE evita un NULL y el total es 0', async () => {
      const { repo } = montar({ getRawOne: { total: '0' } });

      expect(await repo.sumClientBytes(13)).toBe(0);
    });

    it('convierte el total agregado (llega como cadena) a number', async () => {
      const { repo } = montar({ getRawOne: { total: '104857600' } });

      const total = await repo.sumClientBytes(13);

      expect(total).toBe(104857600);
      expect(typeof total).toBe('number');
    });
  });

  describe('listAttachments', () => {
    /**
     * Para un cliente, un adjunto existe **solo si existe su mensaje, es de
     * este ticket y es público** -- exactamente la condición que aplica
     * `TicketAttachmentsService.download`, para que la lista y la descarga no
     * puedan discrepar.
     *
     * Antes era `att.message_id IS NULL OR msg.visibility = 'PUBLICA'` con un
     * `LEFT JOIN`, y ese test fijaba esa rama como comportamiento esperado. Con
     * la descarga ya cerrada, mantenerla dejaba lo peor de las dos opciones: un
     * adjunto que salía en la lista del cliente y daba 404 al descargarlo.
     */
    it('sin includeInternal, exige mensaje público de este ticket con un INNER JOIN', async () => {
      const { repo, createQueryBuilder, llamadas } = montar();

      await repo.listAttachments(13, { includeInternal: false });

      expect(createQueryBuilder).toHaveBeenCalledWith('att');
      expect(llamadas.where[0]).toEqual(['att.ticket_id = :ticketId', { ticketId: 13 }]);
      expect(llamadas.innerJoin[0]).toEqual([
        TicketMessage,
        'msg',
        'msg.id = att.message_id AND msg.ticket_id = att.ticket_id',
      ]);
      expect(llamadas.andWhere[0]).toEqual(['msg.visibility = :visibility', { visibility: 'PUBLICA' }]);
    });

    /**
     * Y el `LEFT JOIN` no vuelve por la puerta de atrás: con él, la fila sin
     * mensaje volvería a salir en la lista del cliente aunque la condición de
     * visibilidad se quedara igual.
     */
    it('sin includeInternal, no usa LEFT JOIN ni deja pasar el adjunto sin mensaje', async () => {
      const { repo, llamadas } = montar();

      await repo.listAttachments(13, { includeInternal: false });

      expect(llamadas.leftJoin).toHaveLength(0);
      expect(JSON.stringify(llamadas.andWhere)).not.toContain('IS NULL');
    });

    it('con includeInternal, no hace ningún join ni añade condición de visibilidad', async () => {
      const { repo, llamadas } = montar();

      await repo.listAttachments(13, { includeInternal: true });

      // Al equipo le existe todo, incluidas las anomalías: es quien tiene que verlas.
      expect(llamadas.leftJoin).toHaveLength(0);
      expect(llamadas.innerJoin).toHaveLength(0);
      expect(llamadas.andWhere).toHaveLength(0);
      expect(llamadas.where[0]).toEqual(['att.ticket_id = :ticketId', { ticketId: 13 }]);
    });

    it('ordena por llegada: created_at y luego id, ambos ascendentes', async () => {
      const { repo, qb } = montar();

      await repo.listAttachments(13, { includeInternal: false });

      expect(qb.orderBy).toHaveBeenCalledWith('att.created_at', 'ASC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('att.id', 'ASC');
    });
  });

});
