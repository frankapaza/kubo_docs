import { TicketsService } from './tickets.service';
import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { TicketMessage } from '../ticket-messages/entities/ticket-message.entity';

/** Lo que una ejecución de `create` llega a escribir, por entidad. */
interface Escrituras {
  tickets: Partial<Ticket>[];
  events: Partial<TicketEvent>[];
  messages: Partial<TicketMessage>[];
}

const vacio = (): Escrituras => ({ tickets: [], events: [], messages: [] });

/** En qué punto de la transacción revienta la base, para los tests de fallo a mitad. */
type PuntoDeFallo = 'ticket' | 'codigo' | 'evento' | 'mensaje';

/**
 * `create` escribe el ticket, le asigna código, registra el evento CREATED y
 * escribe el primer mensaje del hilo **dentro de una única transacción** (ver el
 * docblock de `TicketsService.create`), así que el manager falso expone un stub
 * por entidad -- igual que en `ticket-transitions.service.spec.ts` -- en vez de
 * un único mock compartido.
 *
 * Y, sobre todo, **imita la transacción de verdad**, con el mismo patrón que
 * `ticket-messages.service.spec.ts`: lo que el callback escribe queda en
 * `pendiente`, y solo pasa a `confirmado` si el callback termina bien; si lanza,
 * `pendiente` se descarta. Eso es lo que hace un ROLLBACK, y es lo único que
 * permite afirmar en un test unitario que de un alta a medio escribir **no queda
 * ni el ticket, ni el evento, ni el mensaje**. Con un doble que se limitara a
 * llamar al trabajo a pelo y a acumular en listas incondicionales, ese
 * invariante -- el que esta tarea declara indispensable -- no estaría sujeto por
 * nada: las listas seguirían llenas después del fallo.
 *
 * `fuera` recoge lo que se escriba **con la transacción cerrada**. No es un
 * adorno: una escritura ahí sobrevive a cualquier rollback, así que es
 * exactamente la forma que tendría el fallo que se quiere impedir -- guardar el
 * mensaje por su cuenta, antes o después del `runInTransaction`, en vez de con
 * el manager. Comprobar solo que se pidió el repositorio al manager no lo
 * distinguiría: pedirlo y luego guardar por otro sitio pasaría igual.
 */
const makeService = (fallaEn?: PuntoDeFallo) => {
  let pendiente = vacio();
  const confirmado = vacio();
  const fuera = vacio();
  let dentroDeLaTransaccion = false;
  let ticketState: Partial<Ticket> = {};

  /** Apunta la escritura donde toque: al buffer de la transacción, o al de fuera. */
  const anotar = <T>(lista: keyof Escrituras, saved: T): T => {
    (dentroDeLaTransaccion ? pendiente : fuera)[lista].push(saved as never);
    return saved;
  };

  const ticketRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<Ticket>) => data),
    save: jest.fn().mockImplementation((data: Partial<Ticket>) => {
      if (fallaEn === 'ticket') return Promise.reject(new Error('fallo al guardar el ticket'));
      const saved = { id: 99, ...data };
      anotar('tickets', saved);
      ticketState = saved;
      return Promise.resolve(saved);
    }),
    update: jest.fn().mockImplementation((_id: number, patch: Partial<Ticket>) => {
      if (fallaEn === 'codigo') return Promise.reject(new Error('fallo al asignar el código'));
      ticketState = { ...ticketState, ...patch };
      return Promise.resolve({ affected: 1 });
    }),
    findOneBy: jest.fn().mockImplementation(() => Promise.resolve(ticketState)),
  };

  const eventRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<TicketEvent>) => data),
    save: jest.fn().mockImplementation((data: Partial<TicketEvent>) => {
      if (fallaEn === 'evento') return Promise.reject(new Error('fallo al escribir el evento'));
      return Promise.resolve(anotar('events', { id: pendiente.events.length + 1, ...data }));
    }),
  };

  const messageRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<TicketMessage>) => data),
    save: jest.fn().mockImplementation((data: Partial<TicketMessage>) => {
      if (fallaEn === 'mensaje') return Promise.reject(new Error('fallo al guardar el mensaje'));
      return Promise.resolve(anotar('messages', { id: 700 + pendiente.messages.length, ...data }));
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
    runInTransaction: jest.fn().mockImplementation(async (work: (m: unknown) => Promise<unknown>) => {
      pendiente = vacio();
      dentroDeLaTransaccion = true;
      try {
        const salida = await work(manager);
        confirmado.tickets.push(...pendiente.tickets);
        confirmado.events.push(...pendiente.events);
        confirmado.messages.push(...pendiente.messages);
        return salida;
      } catch (e) {
        // El ROLLBACK: lo escrito a medias no llega a existir.
        pendiente = vacio();
        throw e;
      } finally {
        dentroDeLaTransaccion = false;
      }
    }),
    // Lo que de verdad quedó escrito, que es lo único sobre lo que se puede
    // afirmar nada. Los nombres se conservan por los tests que ya los usaban.
    savedTickets: confirmado.tickets,
    savedEvents: confirmado.events,
    savedMessages: confirmado.messages,
    /** Escrituras hechas con la transacción cerrada: siempre tiene que estar vacío. */
    fuera,
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

  it('el mensaje se escribe con el manager de la transacción, no por su cuenta', async () => {
    const { service, repo, manager } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any);
    expect(manager.getRepository).toHaveBeenCalledWith(TicketMessage);
    // Y de verdad se guardó **dentro**: nada escrito con la transacción
    // cerrada, que es lo que sobreviviría a un rollback. Pedirle el repositorio
    // al manager y luego guardar por otro sitio pasaría la primera aserción y
    // no esta.
    expect(repo.fuera.messages).toHaveLength(0);
    expect(repo.fuera.tickets).toHaveLength(0);
    expect(repo.fuera.events).toHaveLength(0);
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

/**
 * Los dos DTO exigen **un carácter**, no un carácter que se vea: `"   "` pasa
 * la validación y al recortarlo no queda nada.
 *
 * `TicketMessagesService.post` rechaza exactamente ese cuerpo con `BAD_INPUT`
 * («El mensaje no puede estar vacío»), así que el alta no puede escribirlo por
 * detrás: sería la misma fila que el hilo prohíbe, entrando por la otra puerta,
 * y en el portal se vería como una burbuja vacía firmada por el cliente.
 *
 * Se **rechaza el alta**, y no se escribe un ticket sin mensaje. Saltarse el
 * mensaje dejaría un `firstMessageId` que a veces falta, y de ahí sale otra vez
 * la pregunta «¿y si este ticket no tiene mensaje?» que se contesta con un
 * adjunto sin visibilidad heredada -- justo el agujero que esta tarea cierra.
 * Un ticket cuya solicitud está en blanco no es un ticket: es un formulario
 * enviado sin rellenar.
 */
describe('el texto de la solicitud tiene que decir algo', () => {
  it.each([
    ['solo espacios', '   '],
    ['solo saltos de línea', '\n\n'],
    ['espacios y tabuladores', ' \t \t '],
  ])('rechaza un rawText de %s sin escribir nada', async (_etiqueta, texto) => {
    const { service, repo } = makeService();

    const error = await service
      .create({ kind: 'CLIENT', clientUserId: 11 }, { rawText: texto, clientId: 1 } as any)
      .catch((e: any) => e);

    expect(error.getResponse()).toEqual({
      code: 'BAD_INPUT',
      message: 'El texto de la solicitud no puede estar vacío.',
    });
    // Antes de abrir la transacción: no se consulta ni se escribe nada.
    expect(repo.runInTransaction).not.toHaveBeenCalled();
    expect(repo.savedTickets).toHaveLength(0);
    expect(repo.savedMessages).toHaveLength(0);
  });

  it('un texto con espacios alrededor sí vale, y se guarda recortado en los dos sitios', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: '  hay texto  ' } as any);
    expect(repo.savedTickets[0].rawText).toBe('hay texto');
    expect(repo.savedMessages[0].bodyMd).toBe('hay texto');
  });
});

/**
 * **El invariante que esta tarea declara indispensable**: un ticket sin su
 * primer mensaje --o un mensaje sin su ticket-- es un estado que no debe
 * existir. La pantalla de subida cuelga los adjuntos del alta del
 * `firstMessageId`, así que un ticket que naciera sin él dejaría los archivos
 * sin destino y sin forma de recuperarlos.
 *
 * Se prueba reventando la base en cada uno de los cuatro puntos de escritura y
 * comprobando que **no queda nada de nada**. Puede afirmarse porque el doble de
 * `runInTransaction` descarta lo pendiente cuando el callback lanza, que es lo
 * que hace un ROLLBACK.
 */
describe('el alta es todo o nada', () => {
  it.each([
    ['al guardar el ticket', 'ticket'],
    ['al asignar el código', 'codigo'],
    ['al escribir el evento CREATED', 'evento'],
    ['al escribir el primer mensaje', 'mensaje'],
  ] as const)('si falla %s no queda ni ticket, ni evento, ni mensaje', async (_donde, punto) => {
    const { service, repo } = makeService(punto);

    await expect(
      service.create({ kind: 'CLIENT', clientUserId: 11 }, { rawText: 'algo', clientId: 1 } as any),
    ).rejects.toThrow();

    expect(repo.savedTickets).toHaveLength(0);
    expect(repo.savedEvents).toHaveLength(0);
    expect(repo.savedMessages).toHaveLength(0);
    // Y tampoco por la puerta de atrás: nada escrito fuera de la transacción,
    // que es lo único que sobreviviría al rollback.
    expect(repo.fuera.tickets).toHaveLength(0);
    expect(repo.fuera.events).toHaveLength(0);
    expect(repo.fuera.messages).toHaveLength(0);
  });

  /**
   * El caso que da nombre a todo esto, escrito aparte porque es el que se
   * añadió con esta tarea y el que se puede romper sin darse cuenta: si el
   * mensaje reventara, el ticket **tampoco** puede quedar. Antes de que el alta
   * escribiera el hilo, un fallo aquí no existía; ahora es la mitad nueva del
   * invariante.
   */
  it('un fallo del mensaje se lleva por delante el ticket que ya estaba escrito', async () => {
    const { service, repo } = makeService('mensaje');
    await expect(
      service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any),
    ).rejects.toThrow('fallo al guardar el mensaje');
    expect(repo.savedTickets).toHaveLength(0);
  });
});
