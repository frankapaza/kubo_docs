import { In, MoreThanOrEqual } from 'typeorm';

import { InboundEmailsRepository } from './inbound-emails.repository';

/**
 * Mismo motivo que `work-items.repository.spec.ts` y
 * `ticket-events.repository.spec.ts`: estos tests miran los **argumentos**
 * que el repositorio le pasa a TypeORM, con objetos literales completos —
 * nunca `expect.objectContaining`. Si mañana alguien borra `outcome` del
 * `where` de `countRepliesToUnknown`, o deja de mirar la columna de avisos en
 * `findTicketsByEmailMessageIds`, un doble que ya trajera el filtro cableado
 * no lo detectaría porque no ejecuta esa consulta. Aquí sí se ejecuta.
 */
function montar() {
  const repo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((row: unknown) => ({ ...(row as object), id: 'creado' })),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    count: jest.fn().mockResolvedValue(0),
  };
  const ticketsRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
  };
  const eventsRepo = {
    find: jest.fn().mockResolvedValue([]),
  };
  const repository = new InboundEmailsRepository(repo as any, ticketsRepo as any, eventsRepo as any);
  return { repository, repo, ticketsRepo, eventsRepo };
}

describe('InboundEmailsRepository', () => {
  describe('findByMessageId', () => {
    it('busca por el message_id exacto, nada más', async () => {
      const { repository, repo } = montar();

      await repository.findByMessageId('<abc@remitente.com>');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { messageId: '<abc@remitente.com>' } });
    });
  });

  describe('record', () => {
    it('crea la entidad y la guarda, sin transformar la fila recibida', async () => {
      const { repository, repo } = montar();
      const fila = {
        messageId: '<abc@remitente.com>',
        messageIdRaw: '<abc@remitente.com>',
        fromAddress: 'cliente@empresa.com',
        outcome: 'TICKET_CREADO' as const,
        receivedAt: new Date('2026-08-22T10:00:00Z'),
      };

      await repository.record(fila);

      expect(repo.create).toHaveBeenCalledWith(fila);
      // Lo que `create` devuelve es justo lo que `save` debe recibir: el
      // repositorio no debe reconstruir ni tocar la fila entre medias.
      expect(repo.save).toHaveBeenCalledWith({ ...fila, id: 'creado' });
    });
  });

  describe('findTicketByCode', () => {
    it('filtra por code exacto sobre la tabla de tickets', async () => {
      const { repository, ticketsRepo } = montar();

      await repository.findTicketByCode('KB-1234');

      expect(ticketsRepo.findOne).toHaveBeenCalledWith({ where: { code: 'KB-1234' } });
    });
  });

  describe('findTicketsByEmailMessageIds', () => {
    it('con la lista vacía, no consulta nada y devuelve una lista vacía', async () => {
      const { repository, ticketsRepo, eventsRepo } = montar();

      const resultado = await repository.findTicketsByEmailMessageIds([]);

      expect(resultado).toEqual([]);
      expect(ticketsRepo.find).not.toHaveBeenCalled();
      expect(eventsRepo.find).not.toHaveBeenCalled();
    });

    it('busca a la vez en tickets.email_message_id y en la columna de avisos de ticket_events', async () => {
      const { repository, ticketsRepo, eventsRepo } = montar();
      const ids = ['<abierto@x.com>', '<aviso@x.com>'];
      ticketsRepo.find.mockResolvedValueOnce([{ id: '10', clientId: '7' }]);
      eventsRepo.find.mockResolvedValueOnce([]);

      await repository.findTicketsByEmailMessageIds(ids);

      expect(ticketsRepo.find).toHaveBeenNthCalledWith(1, {
        where: { emailMessageId: In(ids) },
      });
      expect(eventsRepo.find).toHaveBeenCalledWith({
        where: { sentMessageId: In(ids) },
      });
    });

    it('un ticket que solo aparece por la columna de avisos también se busca y se incluye', async () => {
      const { repository, ticketsRepo, eventsRepo } = montar();
      const ids = ['<respuesta@x.com>'];
      // Nadie lo abrió con este Message-ID; llegó respondiendo a un aviso.
      ticketsRepo.find.mockResolvedValueOnce([]);
      eventsRepo.find.mockResolvedValueOnce([{ id: '900', ticketId: '22', sentMessageId: ids[0] }]);
      ticketsRepo.find.mockResolvedValueOnce([{ id: '22', clientId: '9' }]);

      const resultado = await repository.findTicketsByEmailMessageIds(ids);

      expect(ticketsRepo.find).toHaveBeenNthCalledWith(2, { where: { id: In(['22']) } });
      expect(resultado).toEqual([{ ticketId: 22, clientId: 9 }]);
    });

    it('un ticket encontrado por las dos vías a la vez no se duplica ni se vuelve a buscar', async () => {
      const { repository, ticketsRepo, eventsRepo } = montar();
      const ids = ['<mismo@x.com>'];
      ticketsRepo.find.mockResolvedValueOnce([{ id: '5', clientId: '3' }]);
      eventsRepo.find.mockResolvedValueOnce([{ id: '901', ticketId: '5', sentMessageId: ids[0] }]);

      const resultado = await repository.findTicketsByEmailMessageIds(ids);

      // Ya cubierto por la primera búsqueda: no hay una segunda llamada a
      // `ticketsRepo.find` pidiendo tickets por id.
      expect(ticketsRepo.find).toHaveBeenCalledTimes(1);
      expect(resultado).toEqual([{ ticketId: 5, clientId: 3 }]);
    });

    it('un ticket sin cliente asignado queda fuera: no hay a quién atribuir la respuesta', async () => {
      const { repository, ticketsRepo, eventsRepo } = montar();
      const ids = ['<interno@x.com>'];
      ticketsRepo.find.mockResolvedValueOnce([{ id: '11', clientId: null }]);
      eventsRepo.find.mockResolvedValueOnce([]);

      const resultado = await repository.findTicketsByEmailMessageIds(ids);

      expect(resultado).toEqual([]);
    });
  });

  describe('countRepliesToUnknown', () => {
    const desde = new Date('2026-08-22T00:00:00Z');

    it('con una dirección, cuenta los descartes de REMITENTE_DESCONOCIDO de esa dirección desde esa fecha', async () => {
      const { repository, repo } = montar();

      await repository.countRepliesToUnknown('desconocido@fuera.com', desde);

      expect(repo.count).toHaveBeenCalledWith({
        where: {
          outcome: 'REMITENTE_DESCONOCIDO',
          fromAddress: 'desconocido@fuera.com',
          receivedAt: MoreThanOrEqual(desde),
        },
      });
    });

    it('sin dirección, cuenta el total de descartes de REMITENTE_DESCONOCIDO desde esa fecha, sin filtrar por remitente', async () => {
      const { repository, repo } = montar();

      await repository.countRepliesToUnknown(desde);

      expect(repo.count).toHaveBeenCalledWith({
        where: {
          outcome: 'REMITENTE_DESCONOCIDO',
          receivedAt: MoreThanOrEqual(desde),
        },
      });
    });
  });
});
