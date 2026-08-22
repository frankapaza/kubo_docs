import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { SlaService } from '../tickets/sla.service';
import { TicketEventsService } from '../tickets/ticket-events.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketEvent } from '../tickets/entities/ticket-event.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { TicketMessagesService } from './ticket-messages.service';

const AHORA = new Date('2026-07-31T10:30:00.000Z');

/** La empresa dueña de los tickets de estos tests. */
const EMPRESA = 3;
const OTRA_EMPRESA = 99;

const CLIENTE = { kind: 'CLIENT', clientUserId: 11, clientId: EMPRESA } as const;
const EQUIPO = { kind: 'STAFF', userId: 5 } as const;

/**
 * El cuerpo del 404, comprobado en las cuatro direcciones (escribir y leer, lo
 * ajeno y lo inexistente): que sean el mismo error no basta, tiene que ser
 * también el mismo cuerpo. Cualquier diferencia entre los dos deja distinguir
 * un ticket que existe de uno que no, que es justo lo que el 404 evita.
 */
const CUERPO_404 = { code: 'NOT_FOUND', message: 'Ticket no encontrado' };

const ticketRow = (over: Partial<Ticket> = {}): Ticket =>
  ({
    id: 7,
    clientId: EMPRESA,
    status: 'EN_ATENCION',
    createdAt: new Date('2026-07-31T08:00:00.000Z'),
    pausedAt: null,
    pausedTotalSeconds: 0,
    slaResponseDueAt: new Date('2026-07-31T08:15:00.000Z'),
    slaResolutionDueAt: new Date('2026-07-31T12:00:00.000Z'),
    firstResponseAt: new Date('2026-07-31T08:10:00.000Z'),
    ...over,
  }) as Ticket;

/** Ticket en espera desde las 09:00: la pausa dura 90 minutos hasta `AHORA`. */
const enEspera = (over: Partial<Ticket> = {}): Ticket =>
  ticketRow({
    status: 'ESPERA_CLIENTE',
    pausedAt: new Date('2026-07-31T09:00:00.000Z'),
    ...over,
  });

type Escrituras = {
  messages: Partial<TicketMessage>[];
  events: Partial<TicketEvent>[];
  ticketPatches: Partial<Ticket>[];
};

const vacio = (): Escrituras => ({ messages: [], events: [], ticketPatches: [] });

/**
 * El servicio real escribe el mensaje, su evento y el cambio de estado con el
 * EntityManager de una única transacción -- mismo idioma que
 * `TicketsService.create` y `TicketTransitionsService.transition`. Estos dobles
 * imitan esa forma **y además la transacción de verdad**: lo que el callback
 * escribe queda en `pendiente`, y solo pasa a `confirmado` si el callback
 * termina bien. Si lanza, `pendiente` se descarta -- que es exactamente lo que
 * hace un ROLLBACK, y lo único que permite comprobar en un test unitario que no
 * queda un mensaje suelto con el ticket todavía en espera.
 *
 * `SlaService` y `TicketEventsService` son los reales (con dependencias nulas:
 * `applyPause` y `typeForTransition` no tocan la base) para que los tests
 * verifiquen el desplazamiento y el tipo de evento de verdad, no un stub que
 * devuelve lo que se le pida.
 */
const makeHarness = (
  ticket: Ticket | null,
  opciones: {
    fallaEn?: 'mensaje' | 'evento-mensaje' | 'evento-transicion' | 'estado';
    /** El UPDATE condicionado no encuentra la fila: alguien movió el ticket antes. */
    carreraPerdida?: boolean;
  } = {},
) => {
  let pendiente = vacio();
  const confirmado = vacio();
  let ticketState = ticket ? { ...ticket } : null;

  const messageRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<TicketMessage>) => data),
    save: jest.fn().mockImplementation((data: Partial<TicketMessage>) => {
      if (opciones.fallaEn === 'mensaje') return Promise.reject(new Error('fallo al guardar el mensaje'));
      const saved = { id: 501, createdAt: new Date(), ...data };
      pendiente.messages.push(saved);
      return Promise.resolve(saved);
    }),
  };

  const eventRepoStub = {
    create: jest.fn().mockImplementation((data: Partial<TicketEvent>) => data),
    save: jest.fn().mockImplementation((data: Partial<TicketEvent>) => {
      if (opciones.fallaEn === 'evento-mensaje' && data.type === 'MESSAGE_POSTED') {
        return Promise.reject(new Error('fallo al escribir el evento del mensaje'));
      }
      if (opciones.fallaEn === 'evento-transicion' && data.type !== 'MESSAGE_POSTED') {
        return Promise.reject(new Error('fallo al escribir el evento de la transicion'));
      }
      const saved = { id: 900 + pendiente.events.length, ...data };
      pendiente.events.push(saved);
      return Promise.resolve(saved);
    }),
  };

  const ticketRepoStub = {
    // Misma forma que el UPDATE condicionado real: criterio y parche, y un
    // `affected` que dice si la fila seguía donde se creía.
    update: jest.fn().mockImplementation((_criterio: unknown, patch: Partial<Ticket>) => {
      if (opciones.fallaEn === 'estado') return Promise.reject(new Error('fallo al mover el estado'));
      if (opciones.carreraPerdida) return Promise.resolve({ affected: 0 });
      pendiente.ticketPatches.push(patch);
      ticketState = { ...(ticketState as Ticket), ...patch };
      return Promise.resolve({ affected: 1 });
    }),
    findOneBy: jest.fn().mockImplementation(() => Promise.resolve(ticketState)),
  };

  const manager = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === TicketMessage) return messageRepoStub;
      if (entity === TicketEvent) return eventRepoStub;
      if (entity === Ticket) return ticketRepoStub;
      throw new Error(`getRepository inesperado: ${String(entity)}`);
    }),
  };

  const tickets = {
    findById: jest.fn().mockResolvedValue(ticket),
    update: jest.fn(),
    create: jest.fn(),
    runInTransaction: jest.fn().mockImplementation(async (work: (m: unknown) => Promise<unknown>) => {
      pendiente = vacio();
      try {
        const salida = await work(manager);
        confirmado.messages.push(...pendiente.messages);
        confirmado.events.push(...pendiente.events);
        confirmado.ticketPatches.push(...pendiente.ticketPatches);
        return salida;
      } catch (e) {
        pendiente = vacio();
        throw e;
      }
    }),
  };

  const messages = { listByTicket: jest.fn().mockResolvedValue([]) };
  const events = new TicketEventsService(null as any);
  const sla = new SlaService(null as any, null as any);
  jest.spyOn(events, 'record');
  jest.spyOn(events, 'typeForTransition');
  jest.spyOn(sla, 'applyPause');

  return {
    service: new TicketMessagesService(tickets as any, messages as any, events, sla),
    tickets,
    messages,
    events,
    sla,
    confirmado,
    ticketRepoStub,
    messageRepoStub,
    eventRepoStub,
  };
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(AHORA);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('post: mensaje de cliente sobre un ticket en espera', () => {
  it('deja el mensaje y el cambio de estado, los dos', async () => {
    const { service, confirmado } = makeHarness(enEspera());

    await service.post(CLIENTE, 7, { bodyMd: 'Ya lo probé, sigue igual.' });

    expect(confirmado.messages).toHaveLength(1);
    expect(confirmado.messages[0].bodyMd).toBe('Ya lo probé, sigue igual.');
    expect(confirmado.ticketPatches).toHaveLength(1);
    expect(confirmado.ticketPatches[0].status).toBe('EN_ATENCION');
    expect(confirmado.events.map((e) => e.type)).toEqual(['MESSAGE_POSTED', 'STATUS_CHANGED']);
  });

  /**
   * El caso que sostiene toda la funcionalidad: un mensaje guardado con el
   * ticket todavía en «Espera cliente» es el ticket dormido con la respuesta
   * dentro. Se monta el fallo a mitad -- el evento de la transición, ya escrito
   * el mensaje y su evento -- y no puede quedar nada.
   */
  it('si falla a mitad no queda ni el mensaje ni el cambio de estado', async () => {
    const { service, confirmado, tickets } = makeHarness(enEspera(), {
      fallaEn: 'evento-transicion',
    });

    await expect(service.post(CLIENTE, 7, { bodyMd: 'Ya lo probé.' })).rejects.toThrow();

    expect(confirmado.messages).toHaveLength(0);
    expect(confirmado.events).toHaveLength(0);
    expect(confirmado.ticketPatches).toHaveLength(0);
    // Y una sola transacción para las tres escrituras, no una por cada una.
    expect(tickets.runInTransaction).toHaveBeenCalledTimes(1);
  });

  it('si falla el cambio de estado tampoco queda el mensaje', async () => {
    const { service, confirmado } = makeHarness(enEspera(), { fallaEn: 'estado' });

    await expect(service.post(CLIENTE, 7, { bodyMd: 'Ya lo probé.' })).rejects.toThrow();

    expect(confirmado.messages).toHaveLength(0);
    expect(confirmado.events).toHaveLength(0);
    expect(confirmado.ticketPatches).toHaveLength(0);
  });

  /**
   * Reanudar es **desplazar**, no recalcular. La pausa duró 90 minutos
   * (09:00 -> 10:30), así que los dos vencimientos se corren 90 minutos: la
   * respuesta de 08:15 a 09:45 y la resolución de 12:00 a 13:30. Un recálculo
   * desde cero daría cualquier otra cosa (08:15 medido desde ahora sería 10:45)
   * y el cliente perdería el tiempo que estuvo esperando.
   */
  it('desplaza los vencimientos por lo que duró la pausa, no los recalcula', async () => {
    const { service, confirmado, sla } = makeHarness(enEspera());

    await service.post(CLIENTE, 7, { bodyMd: 'Respondo.' });

    expect(sla.applyPause).toHaveBeenCalledTimes(1);
    const patch = confirmado.ticketPatches[0];
    expect(patch.slaResponseDueAt).toEqual(new Date('2026-07-31T09:45:00.000Z'));
    expect(patch.slaResolutionDueAt).toEqual(new Date('2026-07-31T13:30:00.000Z'));
    expect(patch.pausedTotalSeconds).toBe(5400);
    expect(patch.pausedAt).toBeNull();
  });

  it('acumula la pausa sobre lo que ya llevaba pausado', async () => {
    const { service, confirmado } = makeHarness(enEspera({ pausedTotalSeconds: 600 }));

    await service.post(CLIENTE, 7, { bodyMd: 'Respondo.' });

    expect(confirmado.ticketPatches[0].pausedTotalSeconds).toBe(6000);
  });

  it('el evento de la transición lleva de dónde a dónde y el actor de cliente', async () => {
    const { service, confirmado } = makeHarness(enEspera());

    await service.post(CLIENTE, 7, { bodyMd: 'Respondo.' });

    const ev = confirmado.events[1];
    expect(ev.fromStatus).toBe('ESPERA_CLIENTE');
    expect(ev.toStatus).toBe('EN_ATENCION');
    expect(ev.actorUserId).toBeNull();
    expect(ev.actorClientUserId).toBe(11);
    // Identificadores en inglés también dentro del payload persistido.
    expect(ev.payload).toEqual({ messageId: 501, automatic: true });
  });

  it('no reescribe first_response_at: la primera respuesta es la del equipo', async () => {
    const { service, confirmado } = makeHarness(enEspera({ firstResponseAt: null }));

    await service.post(CLIENTE, 7, { bodyMd: 'Respondo.' });

    expect(confirmado.ticketPatches[0].firstResponseAt).toBeUndefined();
  });
});

/**
 * El estado se lee con `findById` **fuera** de la transacción, así que entre la
 * lectura y el UPDATE cabe otra escritura: dos mensajes simultáneos del mismo
 * cliente (el doble clic en el portal) o el equipo resolviendo el ticket. Sin
 * condicionar el UPDATE, lo primero desplaza los vencimientos dos veces y lo
 * segundo devuelve a EN_ATENCION un ticket ya resuelto -- una reapertura sin
 * motivo, que es justo lo que `requiresReason` impide por el camino normal.
 */
describe('post: la carrera con quien mueva el ticket a la vez', () => {
  it('el UPDATE va condicionado al estado que se leyó', async () => {
    const { service, ticketRepoStub } = makeHarness(enEspera());

    await service.post(CLIENTE, 7, { bodyMd: 'Respondo.' });

    expect(ticketRepoStub.update).toHaveBeenCalledWith(
      { id: 7, status: 'ESPERA_CLIENTE' },
      expect.objectContaining({ status: 'EN_ATENCION' }),
    );
  });

  it('si el ticket ya no está en espera, el mensaje queda pero no se reactiva', async () => {
    const { service, confirmado } = makeHarness(enEspera(), { carreraPerdida: true });

    const salida = await service.post(CLIENTE, 7, { bodyMd: 'Respondo.' });

    expect(salida.message.id).toBe(501);
    expect(confirmado.messages).toHaveLength(1);
    expect(confirmado.ticketPatches).toHaveLength(0);
    // Y sin evento de una transición que no ha ocurrido.
    expect(confirmado.events.map((e) => e.type)).toEqual(['MESSAGE_POSTED']);
  });
});

/**
 * Un actor de cliente solo existe dentro de su empresa. Sin esta comprobación
 * podría escribir en el hilo de cualquier `ticketId` y leer los mensajes
 * públicos del ticket de otra empresa a base de probar números.
 */
describe('post: de quién es el ticket', () => {
  it('escribir en el ticket de otra empresa da 404, no 403', async () => {
    const { service, tickets } = makeHarness(ticketRow({ clientId: OTRA_EMPRESA }));

    const error = await service.post(CLIENTE, 7, { bodyMd: 'Hola.' }).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    // Mismo cuerpo que un ticket inexistente: un 403 confirmaría que existe.
    expect(error.getResponse()).toEqual(CUERPO_404);
    expect(tickets.runInTransaction).not.toHaveBeenCalled();
  });

  it('un ticket sin cliente no es de nadie del portal', async () => {
    const { service, tickets } = makeHarness(ticketRow({ clientId: null }));

    await expect(service.post(CLIENTE, 7, { bodyMd: 'Hola.' })).rejects.toThrow(NotFoundException);
    expect(tickets.runInTransaction).not.toHaveBeenCalled();
  });

  /**
   * TypeORM devuelve los `bigint` como cadena: con `===`, el `clientId` del
   * token -- un número de verdad -- nunca igualaría al de la base y el dueño
   * legítimo se comería un 404.
   */
  it('el dueño legítimo pasa aunque el clientId llegue como cadena', async () => {
    const { service, confirmado } = makeHarness(
      ticketRow({ clientId: String(EMPRESA) as unknown as number }),
    );

    await service.post(CLIENTE, 7, { bodyMd: 'Hola.' });

    expect(confirmado.messages).toHaveLength(1);
  });

  it('el equipo escribe en cualquier ticket, sea de la empresa que sea', async () => {
    const { service, confirmado } = makeHarness(ticketRow({ clientId: OTRA_EMPRESA }));

    await service.post(EQUIPO, 7, { bodyMd: 'Anotado.' });

    expect(confirmado.messages).toHaveLength(1);
  });
});

/**
 * Un guardia de pertenencia no puede apagarse solo cuando le falta su dato.
 *
 * Con el ámbito codificado como `number | null` -- `null` valiendo a la vez
 * «es del equipo» y «no vino ningún clientId» -- un actor de cliente con
 * `clientId` nulo se saltaba la comprobación **entera** y volvía a leer y
 * escribir en cualquier empresa. Lo revelador es que `undefined`, `0` y `''`
 * sí fallaban cerrado: solo `null` fallaba abierto, que es justo el valor que
 * el informe daba por cubierto.
 *
 * Hoy quien construye el actor es la tarea siguiente y `ClientJwtStrategy`
 * copia el `clientId` del payload del token sin validarlo, así que la frontera
 * no puede darlo por bueno: un actor de cliente sin empresa utilizable lanza y
 * no consulta nada.
 */
describe('un actor de cliente sin clientId utilizable', () => {
  const inservibles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['cero', 0],
    ['cadena vacía', ''],
  ];

  it.each(inservibles)('no escribe en un ticket ajeno: %s', async (_nombre, clientId) => {
    const { service, tickets, confirmado } = makeHarness(ticketRow({ clientId: OTRA_EMPRESA }));

    await expect(
      service.post({ kind: 'CLIENT', clientUserId: 11, clientId } as any, 7, { bodyMd: 'Hola.' }),
    ).rejects.toThrow(UnauthorizedException);

    // Ni siquiera llega a mirar el ticket, y menos a escribir.
    expect(tickets.findById).not.toHaveBeenCalled();
    expect(tickets.runInTransaction).not.toHaveBeenCalled();
    expect(confirmado.messages).toHaveLength(0);
  });

  it.each(inservibles)('no lee el hilo de un ticket ajeno: %s', async (_nombre, clientId) => {
    const { service, tickets, messages } = makeHarness(ticketRow({ clientId: OTRA_EMPRESA }));

    await expect(
      service.listThread({ kind: 'CLIENT', clientUserId: 11, clientId } as any, 7),
    ).rejects.toThrow(UnauthorizedException);

    expect(tickets.findById).not.toHaveBeenCalled();
    expect(messages.listByTicket).not.toHaveBeenCalled();
  });

  it('tampoco escribe en un ticket de su propia empresa: no degrada, lanza', async () => {
    const { service, tickets } = makeHarness(ticketRow());

    await expect(
      service.post({ kind: 'CLIENT', clientUserId: 11, clientId: null } as any, 7, {
        bodyMd: 'Hola.',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(tickets.runInTransaction).not.toHaveBeenCalled();
  });
});

/**
 * El otro medio identificador del actor de cliente, y el que sostiene la
 * invariante de las columnas de autor.
 *
 * `resolveActorIds` promete que exactamente una de las dos columnas va puesta,
 * pero copia el `clientUserId` tal cual: un actor de cliente al que le faltara
 * dejaba un mensaje con **las dos nulas**. Una fila así es un mensaje sin
 * autor -- ya no se sabe si lo dijo el cliente o el equipo --, y un hilo de
 * soporte es justo el registro de quién dijo qué. No se puede reparar después,
 * así que se rechaza antes de escribir nada.
 */
describe('un actor de cliente sin clientUserId utilizable', () => {
  const inservibles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['cero', 0],
    ['cadena vacía', ''],
  ];

  it.each(inservibles)('no escribe ningún mensaje: %s', async (_nombre, clientUserId) => {
    const { service, tickets, confirmado } = makeHarness(ticketRow());

    await expect(
      service.post({ kind: 'CLIENT', clientUserId, clientId: EMPRESA } as any, 7, {
        bodyMd: 'Hola.',
      }),
    ).rejects.toThrow(UnauthorizedException);

    // Antes de escribir nada, y sin ni siquiera mirar el ticket.
    expect(tickets.findById).not.toHaveBeenCalled();
    expect(tickets.runInTransaction).not.toHaveBeenCalled();
    expect(confirmado.messages).toHaveLength(0);
  });

  it.each(inservibles)('no lee ningún hilo: %s', async (_nombre, clientUserId) => {
    const { service, tickets, messages } = makeHarness(ticketRow());

    await expect(
      service.listThread({ kind: 'CLIENT', clientUserId, clientId: EMPRESA } as any, 7),
    ).rejects.toThrow(UnauthorizedException);

    expect(tickets.findById).not.toHaveBeenCalled();
    expect(messages.listByTicket).not.toHaveBeenCalled();
  });

  /** Mismo código y misma forma que el del `clientId`; distinto lo que falta. */
  it('el cuerpo dice que la sesión no identifica a ningún usuario', async () => {
    const { service } = makeHarness(ticketRow());

    const error = await service
      .post({ kind: 'CLIENT', clientUserId: null, clientId: EMPRESA } as any, 7, { bodyMd: 'Hola.' })
      .catch((e) => e);

    expect(error.getResponse()).toEqual({
      code: 'UNAUTHORIZED',
      message: 'La sesión no identifica a ningún usuario.',
    });
  });
});

/**
 * La otra mitad de la misma guarda, la del **actor del equipo**.
 *
 * El argumento del lado cliente vale aquí palabra por palabra: sin un `userId`
 * utilizable, `resolveActorIds` reparte `{ userId: 0, clientUserId: null }` y el
 * mensaje se escribe con las **dos columnas de autor ilegibles**. Y esa fila no
 * es solo un mensaje sin autor: es un mensaje **que dos módulos leen de forma
 * distinta**. `portal-messages.controller.ts` atribuye con `isUsableId`, así que
 * un `author_user_id = 0` no le consta como del equipo y el portal se lo enseña
 * al cliente **firmado como suyo**; el despachador de correos, que pregunta lo
 * mismo por su cuenta, no lo clasifica y no manda nada. Dos respuestas para la
 * misma fila.
 *
 * Que no se viera antes tiene una causa exacta y conviene dejarla escrita: el
 * `EQUIPO` de estos specs siempre trae un `userId` bueno, así que ningún test
 * ejercía la rama. `JwtStrategy.validate` copia el `sub` del payload sin
 * comprobarlo --igual que `ClientJwtStrategy`, que es justo por lo que existe la
 * guarda del otro lado-- y `staffActor` lo pasa tal cual.
 */
describe('un actor del equipo sin userId utilizable', () => {
  const inservibles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['cero', 0],
    ['cadena vacía', ''],
    ['NaN', NaN],
    ['negativo', -1],
    ['no entero', 1.5],
  ];

  it.each(inservibles)('no escribe ningún mensaje: %s', async (_nombre, userId) => {
    const { service, tickets, confirmado } = makeHarness(ticketRow());

    await expect(
      service.post({ kind: 'STAFF', userId } as any, 7, { bodyMd: 'Anotado.' }),
    ).rejects.toThrow(UnauthorizedException);

    // Antes de escribir nada, y sin ni siquiera mirar el ticket.
    expect(tickets.findById).not.toHaveBeenCalled();
    expect(tickets.runInTransaction).not.toHaveBeenCalled();
    expect(confirmado.messages).toHaveLength(0);
  });

  it.each(inservibles)('no lee ningún hilo: %s', async (_nombre, userId) => {
    const { service, tickets, messages } = makeHarness(ticketRow());

    await expect(service.listThread({ kind: 'STAFF', userId } as any, 7)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(tickets.findById).not.toHaveBeenCalled();
    expect(messages.listByTicket).not.toHaveBeenCalled();
  });

  /**
   * Una nota interna tampoco. Es la tentación evidente --«no sale de Kubo, deja
   * pasar»--, pero el hilo es el registro de quién dijo qué y una nota sin autor
   * lo rompe igual; y quien la escribe puede convertirla en respuesta pública
   * copiándola, con la firma ya perdida.
   */
  it('tampoco guarda una nota interna', async () => {
    const { service, confirmado } = makeHarness(ticketRow());

    await expect(
      service.post({ kind: 'STAFF', userId: 0 } as any, 7, {
        bodyMd: 'Revisar logs.',
        visibility: 'INTERNA',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(confirmado.messages).toHaveLength(0);
  });

  /**
   * El mismo cuerpo que el del lado cliente cuando falta el usuario: es la misma
   * situación --la sesión no dice quién escribe-- y dos textos distintos solo
   * sirven para que quien depure crea que son dos situaciones.
   */
  it('el cuerpo dice que la sesión no identifica a ningún usuario', async () => {
    const { service } = makeHarness(ticketRow());

    const error = await service
      .post({ kind: 'STAFF', userId: 0 } as any, 7, { bodyMd: 'Anotado.' })
      .catch((e) => e);

    expect(error.getResponse()).toEqual({
      code: 'UNAUTHORIZED',
      message: 'La sesión no identifica a ningún usuario.',
    });
  });
});

describe('post: cuándo NO se mueve el estado', () => {
  it('un mensaje de cliente sobre un ticket en otro estado no cambia el estado', async () => {
    const { service, confirmado, ticketRepoStub } = makeHarness(ticketRow({ status: 'EN_ATENCION' }));

    await service.post(CLIENTE, 7, { bodyMd: 'Un dato más.' });

    expect(confirmado.messages).toHaveLength(1);
    expect(ticketRepoStub.update).not.toHaveBeenCalled();
    expect(confirmado.events.map((e) => e.type)).toEqual(['MESSAGE_POSTED']);
  });

  it('un mensaje del equipo sobre un ticket en espera no lo reactiva', async () => {
    const { service, confirmado, ticketRepoStub } = makeHarness(enEspera());

    await service.post(EQUIPO, 7, { bodyMd: 'Insisto, ¿nos confirmas?' });

    expect(confirmado.messages).toHaveLength(1);
    expect(ticketRepoStub.update).not.toHaveBeenCalled();
  });

  it('una nota interna del equipo sobre un ticket en espera no lo reactiva', async () => {
    const { service, ticketRepoStub } = makeHarness(enEspera());

    await service.post(EQUIPO, 7, {
      bodyMd: 'Revisar logs antes de insistir.',
      visibility: 'INTERNA',
    });

    expect(ticketRepoStub.update).not.toHaveBeenCalled();
  });
});

describe('post: visibilidad', () => {
  it('un actor de cliente pidiendo INTERNA no crea una nota interna', async () => {
    const { service, confirmado } = makeHarness(ticketRow());

    await service.post(CLIENTE, 7, {
      bodyMd: 'Esto no debería quedar oculto.',
      visibility: 'INTERNA',
    } as { bodyMd: string; visibility: 'INTERNA' });

    expect(confirmado.messages[0].visibility).toBe('PUBLICA');
  });

  it('un cliente pidiendo INTERNA sobre un ticket en espera igual lo reactiva', async () => {
    const { service, confirmado } = makeHarness(enEspera());

    await service.post(CLIENTE, 7, {
      bodyMd: 'Respondo.',
      visibility: 'INTERNA',
    } as { bodyMd: string; visibility: 'INTERNA' });

    // El mensaje es público a la fuerza, así que cuenta como respuesta del cliente.
    expect(confirmado.messages[0].visibility).toBe('PUBLICA');
    expect(confirmado.ticketPatches[0].status).toBe('EN_ATENCION');
  });

  it('el equipo sí puede escribir una nota interna', async () => {
    const { service, confirmado } = makeHarness(ticketRow());

    await service.post(EQUIPO, 7, {
      bodyMd: 'Cliente reincidente, revisar contrato.',
      visibility: 'INTERNA',
    });

    expect(confirmado.messages[0].visibility).toBe('INTERNA');
  });

  it('sin visibilidad explícita el mensaje es público', async () => {
    const { service, confirmado } = makeHarness(ticketRow());

    await service.post(EQUIPO, 7, { bodyMd: 'Ya está desplegado.' });

    expect(confirmado.messages[0].visibility).toBe('PUBLICA');
  });

  it('el evento del mensaje no filtra el cuerpo, solo la visibilidad y el id', async () => {
    const { service, confirmado } = makeHarness(ticketRow());

    await service.post(EQUIPO, 7, {
      bodyMd: 'Cliente reincidente, revisar contrato.',
      visibility: 'INTERNA',
    });

    const ev = confirmado.events[0];
    expect(ev.type).toBe('MESSAGE_POSTED');
    expect(JSON.stringify(ev.payload)).not.toContain('reincidente');
    expect(ev.payload).toEqual({ messageId: 501, visibility: 'INTERNA' });
  });
});

describe('post: columnas de autor', () => {
  it('un mensaje del equipo pone author_user_id y deja nulo el de cliente', async () => {
    const { service, confirmado } = makeHarness(ticketRow());

    await service.post(EQUIPO, 7, { bodyMd: 'Hecho.' });

    const msg = confirmado.messages[0];
    expect(msg.authorUserId).toBe(5);
    expect(msg.authorClientUserId).toBeNull();
    const ev = confirmado.events[0];
    expect(ev.actorUserId).toBe(5);
    expect(ev.actorClientUserId).toBeNull();
  });

  it('un mensaje del portal pone el de cliente y deja nulo author_user_id', async () => {
    const { service, confirmado } = makeHarness(ticketRow());

    await service.post(CLIENTE, 7, { bodyMd: 'Gracias.' });

    const msg = confirmado.messages[0];
    expect(msg.authorUserId).toBeNull();
    expect(msg.authorClientUserId).toBe(11);
    const ev = confirmado.events[0];
    expect(ev.actorUserId).toBeNull();
    expect(ev.actorClientUserId).toBe(11);
  });

  /**
   * `bodyFull` es lo que usa `InboundEmailService` para guardar el cuerpo del
   * correo sin recortar (`bodyMd` sigue siendo el texto ya recortado). Un
   * mensaje del panel o del portal, que no lo manda, se guarda con `null` --
   * nunca con el mismo texto de `bodyMd` repetido por omisión.
   */
  it('bodyFull se guarda cuando lo manda quien llama, y null cuando no', async () => {
    const { service, confirmado } = makeHarness(ticketRow());

    await service.post(CLIENTE, 7, { bodyMd: 'Ya funciona', bodyFull: 'Ya funciona\n\n> cita anterior' });

    expect(confirmado.messages[0].bodyFull).toBe('Ya funciona\n\n> cita anterior');
  });

  it('sin bodyFull, el mensaje se guarda con null, no con bodyMd repetido', async () => {
    const { service, confirmado } = makeHarness(ticketRow());

    await service.post(CLIENTE, 7, { bodyMd: 'Gracias, ya quedó.' });

    expect(confirmado.messages[0].bodyFull).toBeNull();
  });

  it('nunca deja las dos columnas puestas ni las dos nulas', async () => {
    for (const actor of [EQUIPO, CLIENTE]) {
      const { service, confirmado } = makeHarness(ticketRow());
      await service.post(actor, 7, { bodyMd: 'Hola.' });
      const msg = confirmado.messages[0];
      const puestas = [msg.authorUserId, msg.authorClientUserId].filter((v) => v !== null && v !== undefined);
      expect(puestas).toHaveLength(1);
    }
  });

  /**
   * La invariante no la sostiene la unión de TypeScript: basta un `as any`, un
   * JSON deserializado o una variante nueva sin actualizar el reparto. Tiene
   * que fallar cerrado y **antes** de abrir la transacción, como en
   * `TicketsService.create`.
   */
  it('un actor.kind desconocido lanza sin escribir nada', async () => {
    const { service, tickets, confirmado } = makeHarness(ticketRow());

    await expect(
      service.post({ kind: 'ROBOT', userId: 1 } as any, 7, { bodyMd: 'Hola.' }),
    ).rejects.toThrow();

    expect(tickets.runInTransaction).not.toHaveBeenCalled();
    expect(confirmado.messages).toHaveLength(0);
    expect(confirmado.events).toHaveLength(0);
  });
});

describe('post: tickets que no admiten mensajes', () => {
  it('un ticket inexistente da NOT_FOUND sin abrir la transacción', async () => {
    const { service, tickets } = makeHarness(null);

    const error = await service.post(EQUIPO, 404, { bodyMd: 'Hola.' }).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404);
    expect(tickets.runInTransaction).not.toHaveBeenCalled();
  });

  it('un ticket cerrado no admite mensajes', async () => {
    const { service, tickets } = makeHarness(ticketRow({ status: 'CERRADO' }));

    await expect(service.post(EQUIPO, 7, { bodyMd: 'Una cosa más.' })).rejects.toThrow(
      ConflictException,
    );
    expect(tickets.runInTransaction).not.toHaveBeenCalled();
  });

  it('un ticket resuelto sí admite mensajes y no cambia de estado', async () => {
    const { service, confirmado, ticketRepoStub } = makeHarness(ticketRow({ status: 'RESUELTO' }));

    await service.post(CLIENTE, 7, { bodyMd: 'Sigue fallando.' });

    expect(confirmado.messages).toHaveLength(1);
    expect(ticketRepoStub.update).not.toHaveBeenCalled();
  });

  it('un cuerpo vacío o en blanco no se guarda', async () => {
    const { service, tickets } = makeHarness(ticketRow());

    await expect(service.post(EQUIPO, 7, { bodyMd: '   ' })).rejects.toThrow();
    expect(tickets.runInTransaction).not.toHaveBeenCalled();
  });
});

describe('post: disciplina de la transacción', () => {
  it('todas las escrituras pasan por el manager, nunca por los servicios inyectados', async () => {
    const { service, tickets, events, messageRepoStub, eventRepoStub, ticketRepoStub } =
      makeHarness(enEspera());

    await service.post(CLIENTE, 7, { bodyMd: 'Respondo.' });

    expect(messageRepoStub.save).toHaveBeenCalledTimes(1);
    expect(eventRepoStub.save).toHaveBeenCalledTimes(2);
    expect(ticketRepoStub.update).toHaveBeenCalledTimes(1);
    // Los inyectados no escriben: usan su propia conexión y no participarían
    // del commit/rollback.
    expect(events.record).not.toHaveBeenCalled();
    expect(tickets.update).not.toHaveBeenCalled();
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('reutiliza el mapeo real de tipos de evento de la transición', async () => {
    const { service, events } = makeHarness(enEspera());

    await service.post(CLIENTE, 7, { bodyMd: 'Respondo.' });

    expect(events.typeForTransition).toHaveBeenCalledWith('ESPERA_CLIENTE', 'EN_ATENCION');
  });

  /**
   * TypeORM hidrata toda columna `bigint` como cadena aunque la entidad diga
   * `number`, así que el id del ticket puede llegar como '7'. Nada puede
   * depender de un `===` estricto contra un número.
   */
  it('acepta el id del ticket como cadena, tal y como lo devuelve TypeORM', async () => {
    const { service, confirmado, tickets } = makeHarness(enEspera({ id: '7' as unknown as number }));

    await service.post(CLIENTE, '7', { bodyMd: 'Respondo.' });

    expect(tickets.findById).toHaveBeenCalledWith('7');
    expect(confirmado.messages[0].ticketId).toBe('7');
    expect(confirmado.ticketPatches[0].status).toBe('EN_ATENCION');
  });

  it('devuelve el mensaje guardado y el ticket ya actualizado', async () => {
    const { service } = makeHarness(enEspera());

    const salida = await service.post(CLIENTE, 7, { bodyMd: 'Respondo.' });

    expect(salida.message.id).toBe(501);
    expect(salida.ticket.status).toBe('EN_ATENCION');
  });
});

describe('listThread', () => {
  it('un actor de cliente nunca pide las notas internas', async () => {
    const { service, messages } = makeHarness(ticketRow());

    await service.listThread(CLIENTE, 7);

    expect(messages.listByTicket).toHaveBeenCalledWith(7, { includeInternal: false });
  });

  it('el equipo ve el hilo completo', async () => {
    const { service, messages } = makeHarness(ticketRow());

    await service.listThread(EQUIPO, 7);

    expect(messages.listByTicket).toHaveBeenCalledWith(7, { includeInternal: true });
  });

  it('leer el hilo de un ticket de otra empresa da 404, no 403', async () => {
    const { service, messages } = makeHarness(ticketRow({ clientId: OTRA_EMPRESA }));

    const error = await service.listThread(CLIENTE, 7).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404);
    expect(messages.listByTicket).not.toHaveBeenCalled();
  });

  it('el equipo lee el hilo de cualquier empresa', async () => {
    const { service, messages } = makeHarness(ticketRow({ clientId: OTRA_EMPRESA }));

    await service.listThread(EQUIPO, 7);

    expect(messages.listByTicket).toHaveBeenCalledWith(7, { includeInternal: true });
  });

  it('un ticket inexistente da 404 sin consultar el hilo', async () => {
    const { service, messages } = makeHarness(null);

    const error = await service.listThread(CLIENTE, 404).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual(CUERPO_404);
    expect(messages.listByTicket).not.toHaveBeenCalled();
  });

  it('un actor.kind desconocido no lee nada', async () => {
    const { service, messages } = makeHarness(ticketRow());

    await expect(service.listThread({ kind: 'ROBOT' } as any, 7)).rejects.toThrow();
    expect(messages.listByTicket).not.toHaveBeenCalled();
  });
});
