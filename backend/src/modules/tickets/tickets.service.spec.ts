import { TicketsService } from './tickets.service';
import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { TicketMessage } from '../ticket-messages/entities/ticket-message.entity';

/**
 * create() escribe el ticket, le asigna código, registra el evento CREATED y
 * escribe el primer mensaje del hilo dentro de una única transacción (ver
 * comentario en tickets.service.ts), por eso el manager falso expone un stub
 * por entidad -- igual que en ticket-transitions.service.spec.ts -- en vez de
 * un único mock compartido.
 */
const makeService = () => {
  const savedTickets: Partial<Ticket>[] = [];
  const savedEvents: Partial<TicketEvent>[] = [];
  const savedMessages: Partial<TicketMessage>[] = [];
  let ticketState: Partial<Ticket> = {};

  const ticketRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<Ticket>) => data),
    save: jest.fn().mockImplementation((data: Partial<Ticket>) => {
      const saved = { id: 99, ...data };
      savedTickets.push(saved);
      ticketState = saved;
      return Promise.resolve(saved);
    }),
    update: jest.fn().mockImplementation((_id: number, patch: Partial<Ticket>) => {
      ticketState = { ...ticketState, ...patch };
      return Promise.resolve({ affected: 1 });
    }),
    findOneBy: jest.fn().mockImplementation(() => Promise.resolve(ticketState)),
  };

  const eventRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<TicketEvent>) => data),
    save: jest.fn().mockImplementation((data: Partial<TicketEvent>) => {
      const saved = { id: savedEvents.length + 1, ...data };
      savedEvents.push(saved);
      return Promise.resolve(saved);
    }),
  };

  const messageRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<TicketMessage>) => data),
    save: jest.fn().mockImplementation((data: Partial<TicketMessage>) => {
      const saved = { id: 700 + savedMessages.length, ...data };
      savedMessages.push(saved);
      return Promise.resolve(saved);
    }),
  };

  const manager = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === Ticket) return ticketRepoStub;
      if (entity === TicketEvent) return eventRepoStub;
      if (entity === TicketMessage) return messageRepoStub;
      throw new Error(`getRepository inesperado: ${String(entity)}`);
    }),
  };

  const repo = {
    runInTransaction: jest.fn().mockImplementation((work: (m: unknown) => Promise<unknown>) => work(manager)),
    savedTickets,
    savedEvents,
    savedMessages,
  };
  const events = { listByTicket: jest.fn() };
  const sla = {
    initForTicket: jest.fn().mockResolvedValue({
      slaPolicyId: null,
      slaResponseDueAt: null,
      slaResolutionDueAt: null,
    }),
  };
  const clients = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 1 }) };
  const projects = { findById: jest.fn().mockResolvedValue({ id: 1 }) };

  return {
    service: new TicketsService(repo as any, events as any, sla as any, clients as any, projects as any),
    repo,
    manager,
    events,
    sla,
    clients,
    projects,
  };
};

describe('create con actor', () => {
  it('un ticket del equipo pone created_by y deja nulo el de cliente', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any);
    const saved = repo.savedTickets[0];
    expect(saved.createdBy).toBe(5);
    expect(saved.createdByClientUserId).toBeNull();
  });

  it('un ticket del portal pone el de cliente y deja nulo created_by', async () => {
    const { service, repo } = makeService();
    await service.create(
      { kind: 'CLIENT', clientUserId: 11 },
      { rawText: 'algo', clientId: 1 } as any,
    );
    const saved = repo.savedTickets[0];
    expect(saved.createdBy).toBeNull();
    expect(saved.createdByClientUserId).toBe(11);
  });

  /**
   * La invariante "todo ticket tiene exactamente un autor" la sostenia solo la
   * union de TypeScript: con los ternarios `kind === 'STAFF' ? ... : null`, un
   * tercer valor producia un ticket Y su evento CREATED con las dos columnas
   * de actor nulas -- un ticket sin autor, posible desde que la 013 hizo
   * created_by nullable. Falla cerrado y antes de abrir la transaccion.
   */
  it('un actor de tipo no contemplado no crea nada: falla cerrado', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create({ kind: 'ROBOT', userId: 1 } as any, { rawText: 'algo' } as any),
    ).rejects.toThrow();
    expect(repo.runInTransaction).not.toHaveBeenCalled();
    expect(repo.savedTickets).toHaveLength(0);
    expect(repo.savedEvents).toHaveLength(0);
    expect(repo.savedMessages).toHaveLength(0);
  });

  it('el evento CREATED de un ticket del equipo lleva el actor en actor_user_id', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any);
    const ev = repo.savedEvents[0];
    expect(ev.actorUserId).toBe(5);
    expect(ev.actorClientUserId).toBeNull();
  });

  it('el evento CREATED lleva el actor que corresponda', async () => {
    const { service, repo } = makeService();
    await service.create(
      { kind: 'CLIENT', clientUserId: 11 },
      { rawText: 'algo', clientId: 1 } as any,
    );
    const ev = repo.savedEvents[0];
    expect(ev.actorUserId).toBeNull();
    expect(ev.actorClientUserId).toBe(11);
  });
});

/**
 * El alta escribe también el primer mensaje del hilo. Es lo que hace que **todo
 * adjunto cuelgue de un mensaje**, incluidos los que se aportan al crear el
 * ticket: sin esto no habría de dónde colgarlos, y un adjunto sin mensaje no
 * hereda ninguna visibilidad.
 */
describe('el primer mensaje del alta', () => {
  it('el alta escribe un primer mensaje con el texto de quien abre el ticket', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: '  se cayó el ERP  ' } as any);
    expect(repo.savedMessages).toHaveLength(1);
    expect(repo.savedMessages[0].bodyMd).toBe('se cayó el ERP');
  });

  it('el mensaje se escribe en la misma transacción que el ticket y su evento', async () => {
    const { service, manager } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any);
    // Del `manager` de la transacción, nunca de un repositorio inyectado: si
    // saliera de fuera, el mensaje sobreviviría al rollback del ticket.
    expect(manager.getRepository).toHaveBeenCalledWith(TicketMessage);
  });

  it('el primer mensaje cuelga del ticket recién creado', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any);
    expect(repo.savedMessages[0].ticketId).toBe(repo.savedTickets[0].id);
  });

  /**
   * El ticket abierto desde el portal es el caso en el que el mensaje **tiene**
   * que ser público: lo escribió el cliente y tiene que seguir viéndolo en su
   * hilo aunque el triaje con IA reescriba después la descripción del ticket.
   */
  it('el mensaje de un alta del portal es público y lo firma el usuario de cliente', async () => {
    const { service, repo } = makeService();
    await service.create(
      { kind: 'CLIENT', clientUserId: 11 },
      { rawText: 'no puedo facturar', clientId: 1 } as any,
    );
    const msg = repo.savedMessages[0];
    expect(msg.visibility).toBe('PUBLICA');
    expect(msg.authorClientUserId).toBe(11);
    expect(msg.authorUserId).toBeNull();
  });

  /**
   * El del equipo, en cambio, es una nota interna, y esto es la regla que no se
   * puede relajar. `raw_text` en un alta del panel es la captura en crudo -- el
   * WhatsApp pegado, la transcripción sin revisar, lo que el técnico anotó
   * mientras hablaba por teléfono --, y hoy el portal **no** se lo enseña al
   * cliente (`PortalTicketsService.visibleDescription` exige que lo haya escrito
   * él). Publicarlo ahora como primer mensaje sería enseñárselo por la puerta de
   * al lado, y con los adjuntos del alta detrás: el volcado de logs que un
   * técnico arrastra al crear el ticket es exactamente el archivo que la regla
   * de «todo adjunto hereda la visibilidad de su mensaje» existe para no
   * publicar.
   */
  it('el mensaje de un alta del equipo es una nota interna y lo firma el usuario del equipo', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'me llamó y dijo…' } as any);
    const msg = repo.savedMessages[0];
    expect(msg.visibility).toBe('INTERNA');
    expect(msg.authorUserId).toBe(5);
    expect(msg.authorClientUserId).toBeNull();
  });

  /**
   * **Un hecho, un evento.** El alta ya tiene el suyo --CREATED--, y de él ya
   * cuelgan sus dos avisos: el acuse al cliente y el «ticket nuevo por el
   * portal» al equipo (`plansForEvent`). Escribir además un MESSAGE_POSTED por
   * el primer mensaje le añadiría al equipo un segundo correo,
   * TICKET_MESSAGE_FROM_CLIENT, por el mismo hecho y en el mismo segundo. Un
   * correo no se retira: el alta escribe un único evento.
   */
  it('el alta no escribe ningún MESSAGE_POSTED: un solo evento y por tanto un solo aviso', async () => {
    const { service, repo } = makeService();
    await service.create(
      { kind: 'CLIENT', clientUserId: 11 },
      { rawText: 'no puedo facturar', clientId: 1 } as any,
    );
    expect(repo.savedEvents).toHaveLength(1);
    expect(repo.savedEvents[0].type).toBe('CREATED');
    expect(repo.savedEvents.map((e) => e.type)).not.toContain('MESSAGE_POSTED');
  });

  /**
   * Los adjuntos del alta se suben **después**, contra el mensaje recién
   * creado, así que su identificador tiene que salir de aquí. Va siempre, sin
   * ninguna condición: un `firstMessageId` que a veces faltara devolvería a la
   * pantalla de subida la pregunta «¿y si no hay mensaje?», que es justo la
   * rama del adjunto sin visibilidad heredada que se cerró.
   */
  it('create devuelve el identificador del primer mensaje, para colgarle los adjuntos', async () => {
    const { service, repo } = makeService();
    const created = await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any);
    expect(created.firstMessageId).toBe(repo.savedMessages[0].id);
  });
});
