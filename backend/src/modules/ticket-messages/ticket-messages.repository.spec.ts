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
  const llamadas: { where: unknown[]; andWhere: unknown[]; leftJoin: unknown[]; select: unknown[] } = {
    where: [],
    andWhere: [],
    leftJoin: [],
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
  const { qb, llamadas } = montarQueryBuilder(resultado);
  const createQueryBuilder = jest.fn(() => qb);

  const messagesRepo = { find, findOne } as any;
  const attachmentsRepo = { find, findOne, createQueryBuilder } as any;

  const repo = new TicketMessagesRepository(messagesRepo, attachmentsRepo);
  return { repo, find, findOne, createQueryBuilder, qb, llamadas };
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

  describe('listAttachments', () => {
    it('sin includeInternal, une con ticket_messages y exige mensaje público o sin mensaje', async () => {
      const { repo, createQueryBuilder, llamadas } = montar();

      await repo.listAttachments(13, { includeInternal: false });

      expect(createQueryBuilder).toHaveBeenCalledWith('att');
      expect(llamadas.where[0]).toEqual(['att.ticket_id = :ticketId', { ticketId: 13 }]);
      expect(llamadas.leftJoin[0]).toEqual([TicketMessage, 'msg', 'msg.id = att.message_id']);
      expect(llamadas.andWhere[0]).toEqual([
        '(att.message_id IS NULL OR msg.visibility = :visibility)',
        { visibility: 'PUBLICA' },
      ]);
    });

    it('con includeInternal, no hace ningún join ni añade condición de visibilidad', async () => {
      const { repo, llamadas } = montar();

      await repo.listAttachments(13, { includeInternal: true });

      expect(llamadas.leftJoin).toHaveLength(0);
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

  describe('sumBytes', () => {
    it('suma sobre todos los adjuntos del ticket, sin distinguir origen', async () => {
      const { repo, createQueryBuilder, llamadas } = montar({ getRawOne: { total: '4096' } });

      const total = await repo.sumBytes(13);

      expect(createQueryBuilder).toHaveBeenCalledWith('att');
      expect(llamadas.select[0]).toEqual(['COALESCE(SUM(att.size_bytes), 0)', 'total']);
      expect(llamadas.where[0]).toEqual(['att.ticket_id = :ticketId', { ticketId: 13 }]);
      // Ningún join ni condición de visibilidad: cuenta también las notas internas.
      expect(llamadas.leftJoin).toHaveLength(0);
      expect(llamadas.andWhere).toHaveLength(0);
      expect(total).toBe(4096);
    });

    it('sin adjuntos, COALESCE evita un NULL y el total es 0', async () => {
      const { repo } = montar({ getRawOne: { total: '0' } });

      const total = await repo.sumBytes(13);

      expect(total).toBe(0);
    });

    it('convierte el total agregado (llega como cadena) a number', async () => {
      const { repo } = montar({ getRawOne: { total: '104857600' } });

      const total = await repo.sumBytes(13);

      expect(total).toBe(104857600);
      expect(typeof total).toBe('number');
    });
  });
});
