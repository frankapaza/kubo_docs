import { QueryFailedError } from 'typeorm';

import { InboundEmailService } from './inbound-email.service';
import { IncomingMessage } from './mailbox.interface';
import { domainOf } from './domain/message-headers';

/** El error con el que MySQL/mysql2 reporta un choque contra una clave única, tal y como lo envuelve TypeORM. */
function unErrorDeClaveDuplicada(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO inbound_emails ...',
    undefined,
    { code: 'ER_DUP_ENTRY' } as never,
  );
}

/**
 * El recorrido completo de un correo, de la bandeja al hilo -- probado sin
 * red ni base de datos de verdad, con un doble trivial de `Mailbox` (la razón
 * de que ese contrato sea tan pequeño, ver su comentario) y dobles de los
 * cuatro servicios de escritura.
 *
 * El doble de `InboundEmailsRepository` es **con estado** (una tabla en
 * memoria) y no una colección de `jest.fn()` sueltos: desde la ronda de
 * correcciones 1, el servicio reclama la fila antes de escribir el ticket o
 * el mensaje (`claim`) y la corrige después (`updateOutcome`), así que
 * `findByMessageId` tiene que ver de verdad lo que `record` insertó, y
 * `findTicketsByEmailMessageIds` -- que ahora sirve a la vez para detectar un
 * Message-ID envenenado y para correlacionar por cabecera -- tiene que
 * responder según el identificador que se le pida, no según el orden de las
 * llamadas: un `mockResolvedValueOnce` se habría consumido en la primera de
 * las dos comprobaciones, no en la que cada test pretendía preparar.
 */

const BUZON_PROPIO = 'ticket@kuboti.com';

/**
 * Un correo de ejemplo, ya autenticado y sin ninguna de las señales de
 * descarte.
 *
 * `authenticationResults` lleva `header.from=<dominio de "from">` calculado
 * con la MISMA función que usa `InboundEmailService` (`domainOf`, ronda de
 * correcciones 2) -- no un valor fijo. Así, cualquier test que solo cambie
 * `from` (a `tecnico@kuboti.com`, a `nadie@fuera.com`, etc.) sigue
 * autenticando sin tener que acordarse de tocar también la cabecera; los
 * tests que sí quieren probar el veredicto de autenticación en sí
 * (`authenticationResults: null`, `dmarc=fail`...) lo sobrescriben
 * explícitamente vía `overrides`, que gana sobre este cálculo.
 */
function unMensaje(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  const from = overrides.from ?? 'ana@empresa.com';
  return {
    mailboxRef: 'uid-1',
    messageId: '<msg-1@empresa.com>',
    from,
    subject: 'No carga el reporte',
    sentAt: new Date('2026-08-20T10:00:00Z'),
    textBody: 'Hola, el reporte de ventas no carga desde ayer.',
    headers: {},
    authenticationResults: `mx.kuboti.com; dmarc=pass header.from=${domainOf(from) ?? 'sin-dominio.invalid'}`,
    attachmentNames: [],
    ...overrides,
  };
}

const CLIENT_USER = {
  id: 11,
  clientId: 7,
  email: 'ana@empresa.com',
  fullName: 'Ana Quispe',
  isActive: 1,
};

const STAFF_USER = {
  id: 5,
  email: 'tecnico@kuboti.com',
  fullName: 'Un Técnico',
  isActive: 1,
};

/** Lo que devuelve `TicketsService.create`, con los campos que este servicio lee. */
function unTicketCreado(overrides: Record<string, unknown> = {}) {
  return { id: 501, firstMessageId: 9001, clientId: 7, ...overrides };
}

/** Lo que devuelve `TicketMessagesService.post`. */
function unMensajePosteado(overrides: Record<string, unknown> = {}) {
  return {
    message: { id: 9002, ticketId: 501 },
    ticket: { id: 501, clientId: 7 },
    ...overrides,
  };
}

/** Doble de `Mailbox`: entrega los mensajes dados y anota lo que se marcó procesado. */
function mailboxDoble(mensajes: IncomingMessage[]) {
  return {
    fetchUnprocessed: jest.fn().mockResolvedValue(mensajes),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    markUnprocessed: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Doble con estado de `InboundEmailsRepository`.
 *
 * `findTicketsByEmailMessageIds` responde a partir de un mapa
 * `Message-ID -> [{ticketId, clientId}]` que cada test rellena con
 * `asociar(...)`, y no con `mockResolvedValueOnce`: el servicio llama a este
 * método por dos motivos distintos dentro del mismo correo (la comprobación
 * de envenenamiento, con el propio Message-ID; la correlación, con los de
 * `In-Reply-To`/`References`), así que una respuesta "de una vez" ligada al
 * orden de llamada se colaría en la comprobación equivocada.
 */
function repoDoble() {
  const filas: Array<Record<string, unknown> & { id: number }> = [];
  const asociaciones = new Map<string, Array<{ ticketId: number; clientId: number }>>();
  let siguienteId = 1;

  return {
    filas,
    asociar(messageId: string, match: { ticketId: number; clientId: number }) {
      const existentes = asociaciones.get(messageId) ?? [];
      existentes.push(match);
      asociaciones.set(messageId, existentes);
    },
    findByMessageId: jest.fn(async (messageId: string) => {
      return filas.find((f) => f.messageId === messageId) ?? null;
    }),
    findById: jest.fn(async (id: number) => filas.find((f) => f.id === id) ?? null),
    record: jest.fn(async (fila: Record<string, unknown>) => {
      const nueva = { id: siguienteId++, ...fila };
      filas.push(nueva);
      return nueva;
    }),
    updateOutcome: jest.fn(async (id: number, patch: Record<string, unknown>) => {
      const fila = filas.find((f) => f.id === id);
      if (fila) Object.assign(fila, patch);
    }),
    findTicketByCode: jest.fn().mockResolvedValue(null),
    findTicketsByEmailMessageIds: jest.fn(async (ids: string[]) => {
      const encontrados: Array<{ ticketId: number; clientId: number }> = [];
      for (const id of ids) {
        const coincidencias = asociaciones.get(id);
        if (coincidencias) encontrados.push(...coincidencias);
      }
      return encontrados;
    }),
    /**
     * Espejo del repositorio real (`inbound-emails.repository.ts`): filtra
     * `filas` por `outcome` y, con dirección, por `fromAddress` también.
     * Tiene que ser un filtro de verdad -- no un `jest.fn()` suelto -- porque
     * el tope de respuestas a desconocidos (Task 7) se comprueba con lo que
     * el propio `record` de este doble ya insertó dentro del mismo `drain`:
     * un doble sin estado no vería la primera respuesta al decidir la
     * segunda, y ningún test podría demostrar que el tope corta de verdad.
     */
    countRepliesToUnknown: jest.fn(async (addressOrSince: string | Date, maybeSince?: Date) => {
      const since = typeof addressOrSince === 'string' ? (maybeSince as Date) : addressOrSince;
      return filas.filter((f) => {
        if (f.outcome !== 'REMITENTE_DESCONOCIDO') return false;
        if (typeof addressOrSince === 'string' && f.fromAddress !== addressOrSince) return false;
        return (f.receivedAt as Date) >= since;
      }).length;
    }),
    /** Mismo criterio que `countRepliesToUnknown`, para el tope de tickets nuevos por dirección y hora. */
    countNewTicketsByAddress: jest.fn(async (address: string, since: Date) => {
      return filas.filter(
        (f) => f.outcome === 'TICKET_CREADO' && f.fromAddress === address && (f.receivedAt as Date) >= since,
      ).length;
    }),
  };
}

/** `receivedAt` de hace `dias` días, para sembrar filas fuera del recorrido normal del servicio. */
function haceDias(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

/** `receivedAt` de hace `minutos` minutos, para el tope global por hora y el de tickets nuevos. */
function haceMinutos(minutos: number): Date {
  return new Date(Date.now() - minutos * 60 * 1000);
}

interface Opciones {
  mensajes?: IncomingMessage[];
  clientUser?: typeof CLIENT_USER | null;
  staffUser?: typeof STAFF_USER | null;
  crearTicketImpl?: (...args: unknown[]) => Promise<unknown>;
  postMensajeImpl?: (...args: unknown[]) => Promise<unknown>;
  /** El interruptor de la ingesta (`WorkspaceService.isImapIngestionEnabled`) que ve `retry`. Encendido por omisión. */
  ingestionEnabled?: boolean;
  /**
   * El identificador de servidor esperado (`WorkspaceService.getImapAuthServerId`)
   * que `processOne` cruza contra el primer segmento de cada cabecera. Por
   * omisión, el mismo `mx.kuboti.com` que ya lleva `unMensaje()` -- así, un
   * test que solo cambie `from`/`authenticationResults` no tiene que
   * acordarse también de este ajuste.
   */
  authServerId?: string | null;
}

function montar(opciones: Opciones = {}) {
  const {
    mensajes = [unMensaje()],
    clientUser = null,
    staffUser = null,
    crearTicketImpl,
    postMensajeImpl,
    ingestionEnabled = true,
    authServerId = 'mx.kuboti.com',
  } = opciones;

  const mailbox = mailboxDoble(mensajes);
  const repo = repoDoble();
  const tickets = {
    create: crearTicketImpl
      ? jest.fn(crearTicketImpl)
      : jest.fn().mockResolvedValue(unTicketCreado()),
  };
  const ticketMessages = {
    post: postMensajeImpl
      ? jest.fn(postMensajeImpl)
      : jest.fn().mockResolvedValue(unMensajePosteado()),
    attachInboundEmail: jest.fn().mockResolvedValue(undefined),
  };
  const clientUsers = { findByEmail: jest.fn().mockResolvedValue(clientUser) };
  const users = { findByEmail: jest.fn().mockResolvedValue(staffUser) };
  const email = {
    send: jest.fn().mockResolvedValue({ messageId: '<respuesta@kuboti.com>', accepted: [], rejected: [] }),
  };
  const workspace = {
    isImapIngestionEnabled: jest.fn().mockResolvedValue(ingestionEnabled),
    getImapAuthServerId: jest.fn().mockResolvedValue(authServerId),
  };

  const service = new InboundEmailService(
    mailbox as any,
    BUZON_PROPIO,
    repo as any,
    tickets as any,
    ticketMessages as any,
    clientUsers as any,
    users as any,
    email as any,
    workspace as any,
  );

  return { service, mailbox, repo, tickets, ticketMessages, clientUsers, users, email, workspace };
}

/** La fila final de `inbound_emails` para un `messageIdRaw` dado, o `undefined` si no hay ninguna. */
function filaDe(repo: ReturnType<typeof repoDoble>, messageIdRaw: string) {
  return repo.filas.find((f) => f.messageIdRaw === messageIdRaw);
}

describe('InboundEmailService.drain', () => {
  // -------------------------------------------------------------------------
  // Un cliente registrado, sin referencia: crea ticket.
  // -------------------------------------------------------------------------

  describe('un correo de un cliente registrado sin referencia', () => {
    it('crea el ticket con origen EMAIL y el clientId del remitente, nunca de lo que traiga el correo', async () => {
      const { service, tickets, repo } = montar({ clientUser: CLIENT_USER });

      const resumen = await service.drain();

      expect(tickets.create).toHaveBeenCalledTimes(1);
      const [actor, dto, emailOrigin] = tickets.create.mock.calls[0];
      expect(actor).toEqual({ kind: 'CLIENT', clientUserId: 11 });
      expect(dto.origin).toBe('EMAIL');
      expect(dto.clientId).toBe(7);
      expect(emailOrigin).toEqual({
        emailMessageId: '<msg-1@empresa.com>',
        bodyFull: 'Hola, el reporte de ventas no carga desde ayer.',
      });

      // La fila se reclama ANTES de crear el ticket (ticketId aún desconocido)
      // y se corrige después: lo único observable desde fuera es el estado
      // final, que es lo que se comprueba aquí.
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('TICKET_CREADO');
      expect(fila.ticketId).toBe(501);
      expect(fila.clientUserId).toBe(11);
      expect(resumen.ticketsCreated).toBe(1);
    });

    /**
     * "Responde con el número": esta tarea deja el acuse al cliente en manos
     * de la infraestructura que ya existe y ya está probada -- `TicketsService.create`
     * escribe el evento `CREATED` dentro de su propia transacción, y
     * `NotificationDispatcher`/`NotificationScheduler` lo drenan mandando
     * `TICKET_CREATED` con `{{codigo}}` al minuto siguiente (ver el docblock
     * de la clase). Repetir ese envío aquí sería un segundo camino para el
     * mismo correo. Lo único que este test puede -- y debe -- afirmar es que
     * la delegación ocurrió: se llamó a `create`, que es quien deja el evento
     * listo para que el acuse salga.
     */
    it('no manda ningún correo por su cuenta: delega el acuse en el alta del ticket', async () => {
      const { service, email } = montar({ clientUser: CLIENT_USER });

      await service.drain();

      expect(email.send).not.toHaveBeenCalled();
    });

    it('marca el correo como procesado en el buzón', async () => {
      const { service, mailbox } = montar({ clientUser: CLIENT_USER });

      await service.drain();

      expect(mailbox.markProcessed).toHaveBeenCalledWith('uid-1');
    });

    /**
     * Si `TicketsService.create` revienta, la fila reclamada antes NO se
     * queda con `outcome: 'TICKET_CREADO'` y `ticketId: null` para siempre
     * -- eso mentiría en la tabla. `recordError` la encuentra por su
     * Message-ID y la corrige a `ERROR`, en vez de intentar un segundo
     * `INSERT` que la clave única rechazaría.
     */
    it('si la creación falla, la fila reclamada se corrige a ERROR, no queda a medias', async () => {
      const { service, repo } = montar({
        clientUser: CLIENT_USER,
        crearTicketImpl: async () => {
          throw new Error('la base de datos no responde');
        },
      });

      const resumen = await service.drain();

      expect(resumen.errors).toBe(1);
      expect(resumen.ticketsCreated).toBe(0);
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('ERROR');
      expect(fila.reason).toContain('la base de datos no responde');
      expect(fila.ticketId).toBeNull();
      // Una sola fila para este Message-ID: la corrección fue un UPDATE, no
      // un segundo INSERT.
      expect(repo.filas.filter((f) => f.messageIdRaw === '<msg-1@empresa.com>')).toHaveLength(1);
    });

    /**
     * Ronda de correcciones 2, hallazgo 1 (la mitad con carrera). Dos
     * intentos reclaman el mismo Message-ID; solo uno gana el `INSERT` (la
     * clave única del real, simulada aquí con `ER_DUP_ENTRY`). El que pierde
     * no puede "corregir" nada -- no tiene ninguna fila propia -- y, sobre
     * todo, **no puede tocar la fila del que ganó**, que puede llevar ya un
     * ticket de verdad escrito.
     */
    it('si pierde la carrera al reclamar la fila, no toca la del intento que ganó', async () => {
      const { service, repo, tickets } = montar({ clientUser: CLIENT_USER });

      // El ganador: su fila ya existe y terminó bien, con el ticket puesto.
      // `findByMessageId` no la ve -- es la propia naturaleza de la carrera:
      // la lectura de este intento fue anterior a que esa fila existiera.
      const filaGanadora: Record<string, unknown> = {
        id: 999,
        messageId: '<msg-1@empresa.com>',
        messageIdRaw: '<msg-1@empresa.com>',
        outcome: 'TICKET_CREADO',
        ticketId: 777,
        clientUserId: 11,
      };
      repo.filas.push(filaGanadora as never);
      repo.findByMessageId.mockResolvedValueOnce(null);
      repo.record.mockImplementationOnce(() => {
        throw unErrorDeClaveDuplicada();
      });

      const resumen = await service.drain();

      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.errors).toBe(0);
      expect(resumen.duplicates).toBe(1);
      // La fila del ganador, intacta.
      expect(filaGanadora.outcome).toBe('TICKET_CREADO');
      expect(filaGanadora.ticketId).toBe(777);
    });

    /**
     * Ronda de correcciones 2, hallazgo 1 (la mitad sin carrera). El ticket
     * SÍ se crea -- id 501 -- y falla justo el `updateOutcome` que le iba a
     * anotar ese id a la fila reclamada. La corrección tiene que tocar
     * **esa** fila y ninguna otra: se siembra una fila de un correo distinto
     * para demostrar que no se toca.
     */
    it('si falla después de crear el ticket (sin carrera), corrige solo su propia fila', async () => {
      const { service, repo, tickets } = montar({ clientUser: CLIENT_USER });
      const filaAjena: Record<string, unknown> = {
        id: 555,
        messageId: '<otro@empresa.com>',
        messageIdRaw: '<otro@empresa.com>',
        outcome: 'TICKET_CREADO',
        ticketId: 321,
      };
      repo.filas.push(filaAjena as never);
      repo.updateOutcome.mockImplementationOnce(() => {
        throw new Error('ER_LOCK_WAIT_TIMEOUT');
      });

      const resumen = await service.drain();

      expect(tickets.create).toHaveBeenCalledTimes(1);
      expect(resumen.errors).toBe(1);
      expect(resumen.ticketsCreated).toBe(0);
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('ERROR');
      // El ticket 501 se creó de verdad, pero nunca se llegó a anotar aquí:
      // es el residuo aceptado de este fallo concreto (ver el docblock de
      // `claim`), y por eso sigue en null en vez de en 501.
      expect(fila.ticketId).toBeNull();
      // La fila de otro correo, intacta.
      expect(filaAjena.outcome).toBe('TICKET_CREADO');
      expect(filaAjena.ticketId).toBe(321);
    });

    /**
     * Ronda de correcciones 2, hallazgo 2. Sin esta aserción de orden, mover
     * `claim` a después de `tickets.create` deja las 39 pruebas anteriores
     * en verde igual: al fallar, `recordError`/`failClaimedRow` insertan o
     * corrigen una fila con el mismo resultado final, y sigue habiendo una
     * sola. Solo mirando el orden de las llamadas se distingue.
     */
    it('la fila se reclama ANTES de crear el ticket, no después', async () => {
      const { service, repo, tickets } = montar({ clientUser: CLIENT_USER });

      await service.drain();

      const ordenReclamo = repo.record.mock.invocationCallOrder[0];
      const ordenCreacion = tickets.create.mock.invocationCallOrder[0];
      expect(ordenReclamo).toBeLessThan(ordenCreacion);
    });
  });

  // -------------------------------------------------------------------------
  // Una respuesta a un ticket propio: añade mensaje, no crea ticket.
  // -------------------------------------------------------------------------

  describe('una respuesta con In-Reply-To a un ticket propio', () => {
    function montarRespuesta() {
      return montar({
        clientUser: CLIENT_USER,
        mensajes: [
          unMensaje({
            headers: { 'in-reply-to': '<abrio-el-ticket@empresa.com>' },
            textBody: 'Gracias, ya probé y sigue igual.',
          }),
        ],
      });
    }

    it('añade el mensaje al hilo existente y no crea un ticket nuevo', async () => {
      const { service, repo, ticketMessages, tickets } = montarRespuesta();
      repo.asociar('<abrio-el-ticket@empresa.com>', { ticketId: 501, clientId: 7 });

      const resumen = await service.drain();

      expect(ticketMessages.post).toHaveBeenCalledTimes(1);
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.messagesAdded).toBe(1);
      expect(resumen.ticketsCreated).toBe(0);
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('MENSAJE_ANADIDO');
      expect(fila.ticketId).toBe(501);
      expect(fila.clientUserId).toBe(11);
    });

    it('el mensaje añadido lleva el clientUserId del remitente y visibilidad PUBLICA, forzada y no por omisión', async () => {
      const { service, repo, ticketMessages } = montarRespuesta();
      repo.asociar('<abrio-el-ticket@empresa.com>', { ticketId: 501, clientId: 7 });

      await service.drain();

      const [actor, ticketId, input] = ticketMessages.post.mock.calls[0];
      expect(actor).toEqual({ kind: 'CLIENT', clientUserId: 11, clientId: 7 });
      expect(ticketId).toBe(501);
      // Afirmado, no ausente: si mañana se le pidiera 'INTERNA' por error, el
      // valor forzado aquí es lo único que sostiene que un canal externo
      // nunca escriba una nota interna.
      expect(input.visibility).toBe('PUBLICA');
      expect(input.bodyMd).toContain('sigue igual');
    });

    /** Mismo motivo que la equivalente del alta: la aserción de orden es la única que distingue "antes" de "después". */
    it('la fila se reclama ANTES de escribir el mensaje en el hilo, no después', async () => {
      const { service, repo, ticketMessages } = montarRespuesta();
      repo.asociar('<abrio-el-ticket@empresa.com>', { ticketId: 501, clientId: 7 });

      await service.drain();

      const ordenReclamo = repo.record.mock.invocationCallOrder[0];
      const ordenPost = ticketMessages.post.mock.invocationCallOrder[0];
      expect(ordenReclamo).toBeLessThan(ordenPost);
    });
  });

  // -------------------------------------------------------------------------
  // Task 7: el tope de tickets nuevos por dirección y hora.
  // -------------------------------------------------------------------------

  describe('el tope de tickets nuevos por dirección y hora', () => {
    /** 10 tickets ya abiertos por `direccion` en la última hora: el tope está en su límite. */
    function sembrarDiezTicketsRecientes(repo: ReturnType<typeof repoDoble>, direccion: string) {
      for (let i = 0; i < 10; i++) {
        repo.filas.push({
          id: 2000 + i,
          outcome: 'TICKET_CREADO',
          fromAddress: direccion,
          receivedAt: haceMinutos(10),
        });
      }
    }

    it('una dirección que abrió 10 tickets en una hora deja de abrir más', async () => {
      const { service, repo, tickets } = montar({ clientUser: CLIENT_USER });
      sembrarDiezTicketsRecientes(repo, 'ana@empresa.com');

      const resumen = await service.drain();

      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.ticketsCreated).toBe(0);
      expect(resumen.discarded).toBe(1);
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_POR_TOPE');
    });

    /**
     * La distinción que evita que el freno contra el abuso rompa el caso
     * legítimo: la misma dirección, con el mismo tope ya agotado, sigue
     * pudiendo escribir en un hilo que ya tiene abierto -- el tope existe
     * para el correo mal configurado que abre tickets en bucle, no para
     * silenciar a un cliente con una conversación viva.
     */
    it('el tope de tickets nuevos NO afecta a las respuestas a hilos existentes', async () => {
      const { service, repo, ticketMessages, tickets } = montar({
        clientUser: CLIENT_USER,
        mensajes: [
          unMensaje({
            headers: { 'in-reply-to': '<abrio-el-ticket@empresa.com>' },
            textBody: 'Sigo con el mismo problema.',
          }),
        ],
      });
      sembrarDiezTicketsRecientes(repo, 'ana@empresa.com');
      repo.asociar('<abrio-el-ticket@empresa.com>', { ticketId: 501, clientId: 7 });

      const resumen = await service.drain();

      expect(tickets.create).not.toHaveBeenCalled();
      expect(ticketMessages.post).toHaveBeenCalledTimes(1);
      expect(resumen.messagesAdded).toBe(1);
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('MENSAJE_ANADIDO');
    });

    it('si la consulta del tope de tickets nuevos revienta, no se crea el ticket (falla cerrado)', async () => {
      const { service, repo, tickets } = montar({ clientUser: CLIENT_USER });
      repo.countNewTicketsByAddress.mockRejectedValue(new Error('la base no contesta'));

      const resumen = await service.drain();

      expect(tickets.create).not.toHaveBeenCalled();
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_POR_TOPE');
      expect(resumen.errors).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Correo del personal.
  // -------------------------------------------------------------------------

  describe('un correo del personal', () => {
    it('añade un mensaje público del equipo, con authorUserId y visibilidad PUBLICA forzada', async () => {
      const { service, repo, ticketMessages, tickets } = montar({
        staffUser: STAFF_USER,
        mensajes: [unMensaje({ from: 'tecnico@kuboti.com', subject: 'Re: [KB-0501] No carga el reporte' })],
      });
      repo.findTicketByCode.mockResolvedValueOnce({ id: 501, clientId: 7 });

      const resumen = await service.drain();

      expect(ticketMessages.post).toHaveBeenCalledTimes(1);
      const [actor, ticketId, input] = ticketMessages.post.mock.calls[0];
      expect(actor).toEqual({ kind: 'STAFF', userId: 5 });
      expect(ticketId).toBe(501);
      // El mismo test que para el cliente: `post` respeta `visibility` para
      // un actor STAFF (`input.visibility ?? 'PUBLICA'`), así que sin forzarlo
      // aquí explícitamente, un valor 'INTERNA' colado por error pasaría de
      // largo sin que ninguna prueba lo detectara.
      expect(input.visibility).toBe('PUBLICA');
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.messagesAdded).toBe(1);
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('MENSAJE_ANADIDO');
      expect(fila.clientUserId).toBeNull();
    });

    /**
     * No es un error: es un desenlace normal ("este correo no corresponde a
     * ningún ticket"), y por eso no debe sumar al contador de errores ni
     * quedar disponible para "reintentar" en la pantalla de la Task 9 --
     * reintentarlo no cambiaría nada.
     */
    it('un correo del personal sin ningún ticket identificable se descarta como DESCARTADO_SIN_CONTENIDO, no como ERROR', async () => {
      const { service, repo, ticketMessages } = montar({
        staffUser: STAFF_USER,
        mensajes: [unMensaje({ from: 'tecnico@kuboti.com', subject: 'Consulta interna' })],
      });

      const resumen = await service.drain();

      expect(ticketMessages.post).not.toHaveBeenCalled();
      expect(resumen.errors).toBe(0);
      expect(resumen.discarded).toBe(1);
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_SIN_CONTENIDO');
    });

    it('un correo del personal sobre un ticket conocido, cuerpo puro cita: stripQuotedText lo deja intacto y sí se publica', async () => {
      const { service, repo, ticketMessages } = montar({
        staffUser: STAFF_USER,
        mensajes: [
          unMensaje({
            from: 'tecnico@kuboti.com',
            subject: 'Re: [KB-0501] No carga el reporte',
            textBody: '> todo esto es una cita\n> nada mas',
          }),
        ],
      });
      repo.findTicketByCode.mockResolvedValueOnce({ id: 501, clientId: 7 });

      const resumen = await service.drain();

      // OJO: `stripQuotedText` devuelve el original si el recorte lo dejara
      // vacío (para no publicar una burbuja en blanco cuando SÍ se publica
      // algo) -- así que este cuerpo, siendo puro `>`, no se vacía sola. Este
      // test cubre la vía de "hay contenido" (tras stripQuotedText); la vía
      // de "vacío de verdad" está en el test siguiente.
      expect(ticketMessages.post).toHaveBeenCalledTimes(1);
      expect(resumen.errors).toBe(0);
    });

    /**
     * Ronda de correcciones 2, hallazgo 3: el test de arriba, con un cuerpo
     * puramente citado, nunca ejercita de verdad la rama de "cuerpo vacío"
     * de `handleStaffSender` -- `stripQuotedText` no lo vacía. Anular esa
     * rama no mataba ninguna prueba. Este cuerpo sí queda vacío tras
     * recortar (no hay ninguna cita que "no vaciar": es blanco desde el
     * principio), así que sí la ejercita.
     */
    it('un correo del personal sobre un ticket conocido, sin texto de verdad y sin adjuntos, se descarta', async () => {
      const { service, repo, ticketMessages } = montar({
        staffUser: STAFF_USER,
        mensajes: [
          unMensaje({
            from: 'tecnico@kuboti.com',
            subject: 'Re: [KB-0501] No carga el reporte',
            textBody: '   ',
          }),
        ],
      });
      repo.findTicketByCode.mockResolvedValueOnce({ id: 501, clientId: 7 });

      const resumen = await service.drain();

      expect(ticketMessages.post).not.toHaveBeenCalled();
      expect(resumen.errors).toBe(0);
      expect(resumen.discarded).toBe(1);
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_SIN_CONTENIDO');
      expect(fila.ticketId).toBe(501);
    });
  });

  // -------------------------------------------------------------------------
  // El cuerpo vacío tras recortar: tampoco es un error.
  // -------------------------------------------------------------------------

  describe('una respuesta que queda vacía tras recortar la cita', () => {
    it('sin texto y sin adjuntos, se descarta como DESCARTADO_SIN_CONTENIDO', async () => {
      const { service, repo, ticketMessages } = montar({
        clientUser: CLIENT_USER,
        mensajes: [
          unMensaje({
            headers: { 'in-reply-to': '<abrio-el-ticket@empresa.com>' },
            textBody: '   ',
          }),
        ],
      });
      repo.asociar('<abrio-el-ticket@empresa.com>', { ticketId: 501, clientId: 7 });

      const resumen = await service.drain();

      expect(ticketMessages.post).not.toHaveBeenCalled();
      expect(resumen.errors).toBe(0);
      expect(resumen.discarded).toBe(1);
      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_SIN_CONTENIDO');
      // El ticket con el que sí correlacionó queda anotado, aunque no se
      // haya escrito nada en su hilo: es información útil para investigar.
      expect(fila.ticketId).toBe(501);
    });

    it('con adjuntos, aunque el texto quede vacío, sí se publica (la nota de adjuntos cuenta como contenido)', async () => {
      const { service, repo, ticketMessages } = montar({
        clientUser: CLIENT_USER,
        mensajes: [
          unMensaje({
            headers: { 'in-reply-to': '<abrio-el-ticket@empresa.com>' },
            textBody: '   ',
            attachmentNames: ['captura.png'],
          }),
        ],
      });
      repo.asociar('<abrio-el-ticket@empresa.com>', { ticketId: 501, clientId: 7 });

      await service.drain();

      expect(ticketMessages.post).toHaveBeenCalledTimes(1);
      const [, , input] = ticketMessages.post.mock.calls[0];
      expect(input.bodyMd).toContain('captura.png');
    });
  });

  // -------------------------------------------------------------------------
  // Los descartes que nunca responden.
  // -------------------------------------------------------------------------

  describe('los descartes', () => {
    /**
     * Los cuatro montan con un remitente **registrado**: si la comprobación
     * de turno desapareciera, `tickets.create` SÍ se llamaría, y solo así la
     * aserción `not.toHaveBeenCalled()` puede fallar de verdad. Antes de esta
     * ronda, ninguno de los cuatro tenía remitente registrado, así que la
     * aserción pasaba con o sin la comprobación -- exactamente la forma del
     * defecto que esta puerta ya se ha llevado cuatro agujeros por repetir.
     */
    it('sin cabecera de autenticación: DESCARTADO_NO_AUTENTICADO y no se responde', async () => {
      const { service, repo, email, tickets, ticketMessages } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ authenticationResults: null })],
      });

      const resumen = await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_NO_AUTENTICADO');
      expect(email.send).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
      expect(ticketMessages.post).not.toHaveBeenCalled();
      expect(resumen.discarded).toBe(1);
    });

    it('con autenticación fallida (dmarc=fail): igual DESCARTADO_NO_AUTENTICADO, no se responde y no crea nada', async () => {
      const { service, repo, email, tickets } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ authenticationResults: 'mx.kuboti.com; spf=pass; dkim=pass; dmarc=fail' })],
      });

      const resumen = await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_NO_AUTENTICADO');
      expect(email.send).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.discarded).toBe(1);
    });

    /**
     * El agujero de puesta en marcha que `judgeAuthentication` documenta: si
     * el proveedor añade `Authentication-Results` pero nunca corre DMARC, la
     * cabecera SÍ llega (no es `SIN_CABECERA`) pero no trae ningún `dmarc=`.
     * Tiene que rechazarse exactamente igual que un `dmarc=fail` explícito.
     */
    it('con la cabecera presente pero sin ningún dmarc= (SIN_DMARC): también se rechaza', async () => {
      const { service, repo, email, tickets } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ authenticationResults: 'mx.kuboti.com; spf=pass; dkim=pass' })],
      });

      const resumen = await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_NO_AUTENTICADO');
      expect(email.send).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.discarded).toBe(1);
    });

    /**
     * El crítico de la tanda de cierre. Antes de este ancla, `evaluateDmarc`
     * descartaba el primer segmento de la cabecera sin comprobar nunca su
     * valor -- exactamente lo que un remitente puede fabricar dentro de su
     * propio mensaje. Este correo trae una cabecera impecable, con
     * `dmarc=pass` y `header.from=` coincidiendo con el propio `From` (la
     * suplantación completa del docblock de `judgeAuthentication`), pero un
     * identificador de servidor que NO es el configurado: tiene que
     * rechazarse igual que un `dmarc=fail`, nunca colarse como `PASA`.
     */
    it('con un identificador de servidor que no es el nuestro: DESCARTADO_NO_AUTENTICADO, aunque dmarc=pass y los dominios coincidan', async () => {
      const { service, repo, email, tickets } = montar({
        clientUser: CLIENT_USER,
        authServerId: 'mx.kuboti.com',
        mensajes: [
          unMensaje({
            from: 'jefe@kuboti.com',
            authenticationResults:
              'mx.kubo.com; spf=pass smtp.mailfrom=evil.com; dkim=pass header.d=evil.com; ' +
              'dmarc=pass header.from=kuboti.com',
          }),
        ],
      });

      const resumen = await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_NO_AUTENTICADO');
      expect(fila.reason).toContain('SIN_SERVIDOR_PROPIO');
      expect(email.send).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.discarded).toBe(1);
    });

    // Fallo cerrado: sin el ajuste configurado todavía, ningún correo
    // autentica, por limpia que venga su cabecera -- ver
    // `WorkspaceService.getImapAuthServerId`.
    it('sin identificador de servidor configurado (ajuste vacío): se descarta todo, incluso un correo legítimo', async () => {
      const { service, repo, tickets } = montar({
        clientUser: CLIENT_USER,
        authServerId: null,
      });

      const resumen = await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_NO_AUTENTICADO');
      expect(fila.reason).toContain('SIN_SERVIDOR_PROPIO');
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.discarded).toBe(1);
    });

    /**
     * Ronda de correcciones final de la Task 9: antes de normalizar los dos
     * lados del cruce de dominios a su forma codificada (`normalizeDomain`,
     * `domain/message-headers.ts`), un cliente con un dominio
     * internacionalizado se descartaba SIEMPRE, en silencio -- `mailparser`
     * decodifica el dominio de `From` a caracteres nacionales (`пример.com`)
     * cuando es de nivel superior y en minúscula, mientras el servidor de
     * correo escribe `header.from=` siempre en su forma codificada
     * (`xn--e1afmkfd.com`): dos representaciones del MISMO dominio que nunca
     * coincidían como cadena, y el cruce de dominios -- que existe para
     * proteger al cliente legítimo -- lo descartaba a él en su lugar.
     *
     * **Tanda de cierre: este test pasaba antes por el motivo equivocado.**
     * El doble de `clientUsers.findByEmail` (`montar()`, arriba) devuelve
     * `CLIENT_USER` sea cual sea el argumento con el que se le llame -- así
     * que el ticket se creaba igual aunque la búsqueda real (la del
     * repositorio, con su propia normalización) nunca hubiera encontrado a
     * nadie. La aserción sobre `clientUsers.findByEmail` de más abajo es la
     * que de verdad demuestra que el cliente entra por el motivo correcto: la
     * búsqueda se invoca con el dominio ya en su forma codificada, la misma
     * que espera `ClientUsersRepository.findByEmail` tras su propia
     * normalización (ver su spec).
     */
    it('un cliente con dominio internacionalizado no se descarta aunque mailparser decodifique el From a caracteres nacionales', async () => {
      const { service, repo, tickets, clientUsers } = montar({
        clientUser: CLIENT_USER,
        mensajes: [
          unMensaje({
            from: 'ana@пример.com',
            authenticationResults: 'mx.kuboti.com; dmarc=pass header.from=xn--e1afmkfd.com',
          }),
        ],
      });

      const resumen = await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('TICKET_CREADO');
      expect(tickets.create).toHaveBeenCalled();
      expect(resumen.discarded).toBe(0);
      expect(resumen.ticketsCreated).toBe(1);
      expect(clientUsers.findByEmail).toHaveBeenCalledWith('ana@xn--e1afmkfd.com');
    });

    it('un correo automático: DESCARTADO_AUTOMATICO, no se responde y no crea nada', async () => {
      const { service, repo, email, tickets } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ headers: { 'list-id': '<lista.empresa.com>' } })],
      });

      const resumen = await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_AUTOMATICO');
      expect(email.send).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.discarded).toBe(1);
    });

    it('un correo del propio buzón: DESCARTADO_PROPIO, no se responde y no crea nada', async () => {
      const { service, repo, email, tickets } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ from: BUZON_PROPIO })],
      });

      const resumen = await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_PROPIO');
      expect(email.send).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.discarded).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // El From ya llega resuelto por el adaptador: aquí solo se recorta y se
  // pone en minúsculas -- nunca se desenvuelve un "<...>" (ronda de
  // correcciones 2, ver el docblock de `withNormalizedFrom`).
  // -------------------------------------------------------------------------

  describe('el remitente ya llega resuelto: from solo se recorta y se pone en minúsculas', () => {
    it('isOwnMailbox reconoce el buzón propio con mayúsculas y espacios distintos', async () => {
      const { service, repo, tickets } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ from: '  Ticket@Kuboti.com  ' })],
      });

      await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_PROPIO');
      expect(tickets.create).not.toHaveBeenCalled();
    });

    it('la búsqueda de cliente usa la dirección en minúsculas', async () => {
      const { service, clientUsers, tickets } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ from: 'Ana@Empresa.COM' })],
      });

      await service.drain();

      expect(clientUsers.findByEmail).toHaveBeenCalledWith('ana@empresa.com');
      const [, dto] = tickets.create.mock.calls[0];
      expect(dto.clientId).toBe(7);
    });

    /**
     * El crítico de la ronda de correcciones 2 (el séptimo intento contra la
     * suplantación del remitente): `withNormalizedFrom` YA NO desenvuelve un
     * `"<...>"`. La versión anterior sí lo hacía con `extractSenderAddress`,
     * y eso era exactamente el defecto -- `IncomingMessage.from` puede,
     * legítimamente, contener un `<...>` DENTRO de un local-part
     * entrecomillado (`"<jefe@kuboti.com>"@evil.com`, válido por RFC 5322),
     * y ese regex tomaba el `<...>` de dentro como si envolviera la
     * dirección real. Ningún adaptador debería entregar ya la forma
     * "nombre <dirección>" (el contrato cambió, ver `IncomingMessage.from`),
     * pero si alguno lo hiciera de todos modos, el resultado correcto es
     * remitente irreconocible -- nunca una identidad adivinada.
     *
     * Ronda de correcciones final de la Task 9: desde que `domainOf` valida
     * de verdad el dominio (`normalizeDomain`, con `domainToASCII`) en vez de
     * aceptar "lo que siga al último @" tal cual, esa cadena sin desenvolver
     * ya ni siquiera llega a `clientUsers.findByEmail` -- `domainOf` sobre
     * `'"ana quispe" <ana@empresa.com>'` da `null` (el `>` final no es un
     * dominio válido), así que el cruce de dominios la rechaza como no
     * autenticada antes de buscar ningún remitente. Es un resultado más
     * seguro todavía que el anterior (que dependía de que la búsqueda,
     * hecha con la cadena sucia, no encontrara nada por casualidad): aquí ni
     * siquiera se llega a intentar la búsqueda.
     */
    it('un "nombre <dirección>" ya no se desenvuelve: el dominio resultante es inválido y se rechaza sin buscar remitente', async () => {
      const { service, repo, clientUsers, tickets } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ from: '"Ana Quispe" <ana@empresa.com>' })],
      });

      await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_NO_AUTENTICADO');
      expect(clientUsers.findByEmail).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
    });

    /**
     * Ronda de correcciones final de la Task 9: el dominio, además de
     * recortarse y pasarse a minúscula, se reescribe a su forma codificada
     * (`withEncodedDomain`). Cierra un reverso teórico: si el dominio
     * llegara con caracteres nacionales (el mismo defecto de `mailparser`
     * que descarta a un cliente con dominio internacionalizado, ver
     * `domain/message-headers.spec.ts`), la búsqueda de cliente viajaría a
     * una columna MySQL cuya ordenación por defecto ignora los acentos --
     * un dominio real pero distinto podría confundirse con él. Reescribir
     * antes de buscar cierra eso.
     */
    it('el dominio se busca en su forma codificada, no con caracteres nacionales', async () => {
      const { service, clientUsers } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ from: 'ana@пример.com' })],
      });

      await service.drain();

      expect(clientUsers.findByEmail).toHaveBeenCalledWith('ana@xn--e1afmkfd.com');
      expect(clientUsers.findByEmail).not.toHaveBeenCalledWith('ana@пример.com');
    });
  });

  // -------------------------------------------------------------------------
  // Idempotencia: el mismo Message-ID no se procesa dos veces.
  // -------------------------------------------------------------------------

  it('el mismo Message-ID dos veces se procesa una sola vez', async () => {
    const { service, tickets, mailbox } = montar({ clientUser: CLIENT_USER });

    await service.drain();
    expect(tickets.create).toHaveBeenCalledTimes(1);

    // Segunda pasada: el correo sigue en el buzón (p. ej. `markProcessed`
    // falló la vez anterior), y ahora `findByMessageId` sí lo encuentra --
    // porque de verdad quedó insertado la primera vez (doble con estado).
    const resumen = await service.drain();

    expect(tickets.create).toHaveBeenCalledTimes(1);
    expect(resumen.duplicates).toBe(1);
    // Y se sigue intentando marcar: es lo que permite que, si ahora sí
    // funciona, deje de reaparecer en las pasadas siguientes.
    expect(mailbox.markProcessed).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // El espacio de Message-ID envenenado entre empresas.
  // -------------------------------------------------------------------------

  describe('un Message-ID que ya es nuestro (aviso o ticket propio de otra empresa)', () => {
    it('se rechaza como DESCARTADO_DUPLICADO, sin crear ni tocar ningún ticket', async () => {
      const { service, repo, tickets, ticketMessages } = montar({
        clientUser: CLIENT_USER, // empresa 7
        mensajes: [unMensaje({ messageId: '<aviso-de-la-empresa-99@kuboti.com>' })],
      });
      // El identificador que este correo usa como el SUYO PROPIO ya está
      // en uso: es el aviso (o el ticket) de otra empresa.
      repo.asociar('<aviso-de-la-empresa-99@kuboti.com>', { ticketId: 990, clientId: 99 });

      const resumen = await service.drain();

      expect(tickets.create).not.toHaveBeenCalled();
      expect(ticketMessages.post).not.toHaveBeenCalled();
      const fila = filaDe(repo, '<aviso-de-la-empresa-99@kuboti.com>')!;
      expect(fila.outcome).toBe('DESCARTADO_DUPLICADO');
      expect(resumen.discarded).toBe(1);
    });

    it('un Message-ID propio de verdad (no reutilizado) no dispara el rechazo', async () => {
      const { service, tickets } = montar({ clientUser: CLIENT_USER });
      // Ninguna asociación registrada para '<msg-1@empresa.com>': sigue
      // siendo un Message-ID genuinamente nuevo.

      const resumen = await service.drain();

      expect(tickets.create).toHaveBeenCalledTimes(1);
      expect(resumen.ticketsCreated).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Remitente desconocido.
  // -------------------------------------------------------------------------

  describe('un remitente desconocido', () => {
    it('un correo suyo se responde una vez y se registra REMITENTE_DESCONOCIDO', async () => {
      const { service, repo, email } = montar({ mensajes: [unMensaje({ from: 'nadie@fuera.com' })] });

      const resumen = await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('REMITENTE_DESCONOCIDO');
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(email.send.mock.calls[0][0].to).toBe('nadie@fuera.com');
      expect(resumen.unknownSenders).toBe(1);
    });

    /**
     * El texto final (no el provisional que dejó la Task 6): dice que la
     * dirección no está registrada, manda a escribirle a una persona de
     * Kubo -- no a "su administrador", que puede no existir si la empresa
     * nunca se dio de alta --, no reproduce nada del correo original (ni el
     * asunto ni el cuerpo que mandó el desconocido), y va marcada como
     * automática (RFC 3834) para que un autorespondedor del otro lado no
     * conteste y cierre el bucle.
     */
    it('el texto de la respuesta manda a una persona de Kubo, no cita el correo original, y va marcada como automática', async () => {
      const asunto = 'Necesito ayuda urgente con mi pedido #4521';
      const cuerpo = 'Esto es confidencial: mi número de cuenta es 000-111-222.';
      const { service, email } = montar({
        mensajes: [unMensaje({ from: 'nadie@fuera.com', subject: asunto, textBody: cuerpo })],
      });

      await service.drain();

      const envio = email.send.mock.calls[0][0];
      expect(envio.text).toMatch(/no está registrada/i);
      expect(envio.text).toMatch(/kubo/i);
      expect(envio.text).not.toMatch(/administrador/i);
      expect(envio.text).not.toContain(asunto);
      expect(envio.text).not.toContain(cuerpo);
      expect(envio.html).not.toContain(asunto);
      expect(envio.html).not.toContain(cuerpo);
      // El asunto es la otra superficie de "no amplificar": un `Re: <asunto
      // original>` -- el cambio más natural del mundo para dar contexto --
      // le devolvería al remitente su propio texto tal cual se lo mandó.
      expect(envio.subject).not.toContain(asunto);
      expect(envio.subject).not.toContain(cuerpo);
      expect(envio.headers).toEqual({ 'Auto-Submitted': 'auto-generated' });
    });

    it('el registro se escribe antes de intentar la respuesta', async () => {
      const { service, repo, email } = montar({ mensajes: [unMensaje({ from: 'nadie@fuera.com' })] });

      await service.drain();

      const ordenRegistro = repo.record.mock.invocationCallOrder[0];
      const ordenRespuesta = email.send.mock.invocationCallOrder[0];
      expect(ordenRegistro).toBeLessThan(ordenRespuesta);
    });

    // -----------------------------------------------------------------------
    // Task 7: el tope de respuestas a un remitente desconocido.
    // -----------------------------------------------------------------------

    it('dos correos del mismo desconocido en el mismo lote: solo se responde al primero, el segundo se descarta por tope', async () => {
      const { service, repo, email } = montar({
        mensajes: [
          unMensaje({ messageId: '<primero@fuera.com>', from: 'nadie@fuera.com' }),
          unMensaje({ messageId: '<segundo@fuera.com>', from: 'nadie@fuera.com' }),
        ],
      });

      await service.drain();

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(filaDe(repo, '<primero@fuera.com>')!.outcome).toBe('REMITENTE_DESCONOCIDO');
      expect(filaDe(repo, '<segundo@fuera.com>')!.outcome).toBe('DESCARTADO_POR_TOPE');
    });

    it('a una dirección que ya recibió respuesta hace 2 días (dentro del enfriamiento), NO se le responde', async () => {
      const { service, repo, email } = montar({ mensajes: [unMensaje({ from: 'nadie@fuera.com' })] });
      repo.filas.push({
        id: 900,
        outcome: 'REMITENTE_DESCONOCIDO',
        fromAddress: 'nadie@fuera.com',
        receivedAt: haceDias(2),
      });

      await service.drain();

      expect(email.send).not.toHaveBeenCalled();
      expect(filaDe(repo, '<msg-1@empresa.com>')!.outcome).toBe('DESCARTADO_POR_TOPE');
    });

    it('a una dirección que la recibió hace 8 días (fuera del enfriamiento de 7), sí se le responde', async () => {
      const { service, repo, email } = montar({ mensajes: [unMensaje({ from: 'nadie@fuera.com' })] });
      repo.filas.push({
        id: 900,
        outcome: 'REMITENTE_DESCONOCIDO',
        fromAddress: 'nadie@fuera.com',
        receivedAt: haceDias(8),
      });

      await service.drain();

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(filaDe(repo, '<msg-1@empresa.com>')!.outcome).toBe('REMITENTE_DESCONOCIDO');
    });

    it('superado el tope global por hora, no se responde a nadie más y se registra el descarte', async () => {
      const { service, repo, email } = montar({
        mensajes: [unMensaje({ from: 'el-numero-21@fuera.com' })],
      });
      // 20 respuestas ya mandadas en la última hora, a 20 direcciones
      // distintas -- el tope global no distingue direcciones, así que
      // ninguna de ellas puede coincidir con la del correo de este test.
      for (let i = 0; i < 20; i++) {
        repo.filas.push({
          id: 1000 + i,
          outcome: 'REMITENTE_DESCONOCIDO',
          fromAddress: `ya-respondido-${i}@fuera.com`,
          receivedAt: haceMinutos(10),
        });
      }

      await service.drain();

      expect(email.send).not.toHaveBeenCalled();
      expect(filaDe(repo, '<msg-1@empresa.com>')!.outcome).toBe('DESCARTADO_POR_TOPE');
    });

    /**
     * "Un tope que falla abierto no es un tope": si la consulta que sostiene
     * la decisión revienta, no hay forma de saber si el enfriamiento o el
     * tope global ya se agotaron, así que se trata como si sí -- se descarta
     * y no se manda nada. La alternativa (asumir "sin historial" ante un
     * error) decidiría por la AUSENCIA del dato, no por el hecho que debía
     * determinarlo.
     */
    it('si la consulta del tope revienta, se descarta y no se responde (falla cerrado)', async () => {
      const { service, repo, email } = montar({ mensajes: [unMensaje({ from: 'nadie@fuera.com' })] });
      repo.countRepliesToUnknown.mockRejectedValue(new Error('la base no contesta'));

      const resumen = await service.drain();

      expect(email.send).not.toHaveBeenCalled();
      expect(filaDe(repo, '<msg-1@empresa.com>')!.outcome).toBe('DESCARTADO_POR_TOPE');
      // Una consulta que revienta al decidir el tope no es un correo roto de
      // verdad (no hay nada mal en el correo en sí): no debe contarse como
      // `ERROR`, ni impedir que el resto del lote se procese.
      expect(resumen.errors).toBe(0);
    });

    it('un usuario de cliente desactivado también cuenta como desconocido', async () => {
      const { service, repo, email } = montar({
        clientUser: { ...CLIENT_USER, isActive: 0 },
      });

      await service.drain();

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.outcome).toBe('REMITENTE_DESCONOCIDO');
      expect(email.send).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Un correo que revienta no para la cola.
  // -------------------------------------------------------------------------

  it('un correo que revienta al procesarse se registra ERROR y el siguiente se procesa igual', async () => {
    const primero = unMensaje({
      mailboxRef: 'uid-1',
      messageId: '<falla@empresa.com>',
      textBody: 'Este correo revienta al procesarse.',
    });
    const segundo = unMensaje({
      mailboxRef: 'uid-2',
      messageId: '<bien@empresa.com>',
      textBody: 'Este correo se procesa con normalidad.',
    });
    const { service, repo, tickets, mailbox } = montar({
      clientUser: CLIENT_USER,
      mensajes: [primero, segundo],
      crearTicketImpl: async (...args: unknown[]) => {
        const dto = args[1] as { rawText: string };
        if (dto.rawText.includes('revienta')) {
          throw new Error('la base de datos no responde');
        }
        return unTicketCreado();
      },
    });

    const resumen = await service.drain();

    expect(resumen.errors).toBe(1);
    expect(resumen.ticketsCreated).toBe(1);
    expect(filaDe(repo, '<falla@empresa.com>')!.outcome).toBe('ERROR');
    expect(filaDe(repo, '<falla@empresa.com>')!.reason).toContain('la base de datos no responde');
    expect(filaDe(repo, '<bien@empresa.com>')!.outcome).toBe('TICKET_CREADO');
    // Los dos correos se marcan procesados, reviente uno o no.
    expect(mailbox.markProcessed).toHaveBeenCalledWith('uid-1');
    expect(mailbox.markProcessed).toHaveBeenCalledWith('uid-2');
  });

  // -------------------------------------------------------------------------
  // LA PRUEBA QUE CIERRA EL PROYECTO.
  // -------------------------------------------------------------------------

  it('un cliente de la empresa 7 no puede escribir en el hilo de la empresa 99 poniendo su código en el asunto', async () => {
    const { service, repo, ticketMessages, tickets } = montar({
      clientUser: CLIENT_USER, // empresa 7
      mensajes: [unMensaje({ subject: 'Re: [KB-0099] Algo de otra empresa' })],
    });
    // El ticket KB-0099 existe, pero es de la empresa 99.
    repo.findTicketByCode.mockResolvedValueOnce({ id: 99, clientId: 99 });

    const resumen = await service.drain();

    expect(ticketMessages.post).not.toHaveBeenCalled();
    expect(tickets.create).toHaveBeenCalledTimes(1);
    const [, dto] = tickets.create.mock.calls[0];
    expect(dto.clientId).toBe(7);
    expect(resumen.ticketsCreated).toBe(1);
    expect(resumen.messagesAdded).toBe(0);
  });

  // -------------------------------------------------------------------------
  // El cuerpo: recorte, cuerpo completo, y la nota de adjuntos.
  // -------------------------------------------------------------------------

  describe('el cuerpo del mensaje', () => {
    it('el cuerpo recortado va al ticket y el original completo a emailOrigin.bodyFull', async () => {
      const { service, tickets } = montar({
        clientUser: CLIENT_USER,
        mensajes: [
          unMensaje({
            textBody:
              'Ya se solucionó, gracias.\n\nEl vie, 21 ago 2026 a las 09:00, Soporte <ticket@kuboti.com> escribió:\n> hola',
          }),
        ],
      });

      await service.drain();

      const [, dto, emailOrigin] = tickets.create.mock.calls[0];
      expect(dto.rawText).toBe('Ya se solucionó, gracias.');
      expect(emailOrigin.bodyFull).toContain('escribió:');
      expect(emailOrigin.bodyFull).toContain('> hola');
    });

    it('un correo con adjuntos anota cuántos y sus nombres, sin descargarlos', async () => {
      const { service, tickets, repo } = montar({
        clientUser: CLIENT_USER,
        mensajes: [unMensaje({ attachmentNames: ['factura.pdf', 'foto.png'] })],
      });

      await service.drain();

      const [, dto, emailOrigin] = tickets.create.mock.calls[0];
      expect(dto.rawText).toContain('factura.pdf');
      expect(dto.rawText).toContain('foto.png');
      expect(dto.rawText).toContain('2 adjuntos');
      // El cuerpo completo no lleva la nota: es el correo tal cual llegó.
      expect(emailOrigin.bodyFull).not.toContain('adjuntos');

      const fila = filaDe(repo, '<msg-1@empresa.com>')!;
      expect(fila.attachmentCount).toBe(2);
      expect(fila.attachmentNames).toEqual(['factura.pdf', 'foto.png']);
    });
  });

  // -------------------------------------------------------------------------
  // El enlace entre el mensaje y su correo de origen (informativo).
  // -------------------------------------------------------------------------

  it('enlaza el primer mensaje del ticket con la fila de inbound_emails que lo originó', async () => {
    const { service, ticketMessages, repo } = montar({ clientUser: CLIENT_USER });

    await service.drain();

    const fila = filaDe(repo, '<msg-1@empresa.com>')!;
    expect(ticketMessages.attachInboundEmail).toHaveBeenCalledWith(9001, fila.id);
  });

  it('un fallo al enlazar el mensaje no tira el resto: el ticket ya está escrito', async () => {
    const { service, ticketMessages, repo } = montar({ clientUser: CLIENT_USER });
    ticketMessages.attachInboundEmail.mockRejectedValueOnce(new Error('fallo de red'));

    const resumen = await service.drain();

    expect(resumen.errors).toBe(0);
    expect(resumen.ticketsCreated).toBe(1);
    expect(filaDe(repo, '<msg-1@empresa.com>')!.outcome).toBe('TICKET_CREADO');
  });
});

/**
 * El reintento (Task 9): "no reprocesa, re-encola". Se prueba aparte de
 * `drain` porque no comparte ningún camino con él salvo los dobles.
 */
describe('InboundEmailService.retry', () => {
  const FILA_ERROR = {
    id: 55,
    messageId: '<falla@empresa.com>',
    messageIdRaw: '<falla@empresa.com>',
    fromAddress: 'ana@empresa.com',
    outcome: 'ERROR' as const,
    reason: 'Fallo de red al escribir el ticket.',
    // `null` explícito, no ausente: el camino de `TICKET_CREADO` (`claim` con
    // `ticketId: null`, corregido solo si `tickets.create` termina bien) es
    // el único que puede acabar en `ERROR` con este campo en `null` -- ver el
    // docblock de `InboundEmailService.retry`.
    ticketId: null as number | null,
  };

  it('quita la marca en el buzón por el Message-ID crudo, y renombra la fila para liberar la clave única', async () => {
    const { service, mailbox, repo } = montar();
    repo.filas.push({ ...FILA_ERROR });

    const resultado = await service.retry(55, 'tecnico@kuboti.com');

    expect(mailbox.markUnprocessed).toHaveBeenCalledWith('<falla@empresa.com>');
    expect(resultado.messageId).not.toBe('<falla@empresa.com>');
    expect(resultado.messageId).toMatch(/^<falla@empresa\.com>#reintento-55-\d+$/);
    // El outcome NO cambia: la fila sigue siendo el rastro histórico del error.
    expect(resultado.outcome).toBe('ERROR');
  });

  it('conserva el motivo original y añade quién lo reintentó y cuándo', async () => {
    const { service, repo } = montar();
    repo.filas.push({ ...FILA_ERROR });

    const resultado = await service.retry(55, 'tecnico@kuboti.com');

    expect(resultado.reason).toContain('Fallo de red al escribir el ticket.');
    expect(resultado.reason).toContain('tecnico@kuboti.com');
    expect(resultado.reason).toContain('Reencolado el');
  });

  it('sin esa fila, no toca el buzón y lo dice', async () => {
    const { service, mailbox } = montar();

    await expect(service.retry(999, 'tecnico@kuboti.com')).rejects.toThrow();
    expect(mailbox.markUnprocessed).not.toHaveBeenCalled();
  });

  it.each([
    ['TICKET_CREADO' as const],
    ['MENSAJE_ANADIDO' as const],
    ['DESCARTADO_SIN_CONTENIDO' as const],
  ])('una fila que no está en ERROR (%s) no se reintenta, y no toca el buzón', async (outcome) => {
    const { service, mailbox, repo } = montar();
    repo.filas.push({ ...FILA_ERROR, outcome });

    await expect(service.retry(55, 'tecnico@kuboti.com')).rejects.toThrow();
    expect(mailbox.markUnprocessed).not.toHaveBeenCalled();
  });

  it('sin messageIdRaw guardado, no se puede reencolar y no se intenta nada en el buzón', async () => {
    const { service, mailbox, repo } = montar();
    repo.filas.push({ ...FILA_ERROR, messageIdRaw: null });

    await expect(service.retry(55, 'tecnico@kuboti.com')).rejects.toThrow();
    expect(mailbox.markUnprocessed).not.toHaveBeenCalled();
  });

  /**
   * Si el buzón no pudo quitar la marca (el correo ya no está, o cualquier
   * otro fallo de red/protocolo), la fila NO se toca: renombrarla igual
   * liberaría la clave única de un correo que en realidad nunca va a volver,
   * perdiéndolo en vez de reencolarlo.
   */
  it('si el buzón no pudo reencolar, la fila queda exactamente igual y el fallo se ve', async () => {
    const { service, mailbox, repo } = montar();
    repo.filas.push({ ...FILA_ERROR });
    mailbox.markUnprocessed.mockRejectedValueOnce(new Error('el correo ya no está en el buzón'));

    await expect(service.retry(55, 'tecnico@kuboti.com')).rejects.toThrow(/el correo ya no está en el buzón/);

    const filaTrasElIntento = repo.filas.find((f) => f.id === 55)!;
    expect(filaTrasElIntento.messageId).toBe('<falla@empresa.com>');
    expect(filaTrasElIntento.reason).toBe('Fallo de red al escribir el ticket.');
  });

  it('dos filas en error distintas se reencolan de forma independiente', async () => {
    const { service, mailbox, repo } = montar();
    repo.filas.push({ ...FILA_ERROR }, { ...FILA_ERROR, id: 56, messageId: '<otra@empresa.com>', messageIdRaw: '<otra@empresa.com>' });

    await service.retry(55, 'tecnico@kuboti.com');
    await service.retry(56, 'otra@kuboti.com');

    expect(mailbox.markUnprocessed).toHaveBeenNthCalledWith(1, '<falla@empresa.com>');
    expect(mailbox.markUnprocessed).toHaveBeenNthCalledWith(2, '<otra@empresa.com>');
    expect(repo.filas.find((f) => f.id === 55)!.messageId).not.toBe(repo.filas.find((f) => f.id === 56)!.messageId);
  });

  /**
   * B1: con la ingesta apagada -- el estado por omisión -- reencolar no toca
   * nada del buzón ni de la fila: nada va a leerla nunca, así que fingir que
   * se reencoló sería mentirle al operador (la pantalla diría "se procesará
   * en el siguiente ciclo" sobre un correo que ningún reloj va a mirar).
   */
  it('con la ingesta apagada, no reencola y no toca el buzón', async () => {
    const { service, mailbox, repo, workspace } = montar({ ingestionEnabled: false });
    repo.filas.push({ ...FILA_ERROR });

    await expect(service.retry(55, 'tecnico@kuboti.com')).rejects.toThrow(/ingesta de correo está apagada/);

    expect(workspace.isImapIngestionEnabled).toHaveBeenCalled();
    expect(mailbox.markUnprocessed).not.toHaveBeenCalled();
    expect(repo.filas.find((f) => f.id === 55)!.messageId).toBe('<falla@empresa.com>');
  });

  it('si la consulta del interruptor revienta, se trata como apagada (falla cerrado) y no se reencola', async () => {
    const { service, mailbox, repo, workspace } = montar();
    workspace.isImapIngestionEnabled.mockRejectedValueOnce(new Error('la base no responde'));
    repo.filas.push({ ...FILA_ERROR });

    await expect(service.retry(55, 'tecnico@kuboti.com')).rejects.toThrow(/ingesta de correo está apagada/);
    expect(mailbox.markUnprocessed).not.toHaveBeenCalled();
  });

  /**
   * B2: el hecho que decide si una fila ya se reencoló no es su `outcome`
   * (se queda en `ERROR` a propósito) sino si su `messageId` ya lleva el
   * sufijo de `buildRequeuedMessageId`. Sin esto, un segundo reintento
   * desmarcaría en el buzón el `Message-ID` ORIGINAL -- que la ingesta
   * automática ya pudo haber vuelto a procesar hace tiempo -- y lo
   * reprocesaría una segunda vez.
   */
  it('una fila que ya se reencoló antes (su messageId lleva el sufijo) no se vuelve a reencolar', async () => {
    const { service, mailbox, repo } = montar();
    repo.filas.push({
      ...FILA_ERROR,
      messageId: '<falla@empresa.com>#reintento-55-1755882600000',
    });

    await expect(service.retry(55, 'tecnico@kuboti.com')).rejects.toThrow(/ya se reencoló antes/);
    expect(mailbox.markUnprocessed).not.toHaveBeenCalled();
  });

  /**
   * B3: la ingesta nunca guarda `null` en `messageIdRaw` -- para un correo
   * sin cabecera `Message-ID` propia guarda el sustituto sintético
   * (`syntheticMessageId`). Ese valor nunca fue una cabecera real del buzón,
   * así que hay que negarse aquí, con un motivo verdadero, en vez de dejar
   * que `markUnprocessed` lo intente y falle con un motivo inventado ("puede
   * que alguien lo haya borrado a mano").
   */
  it('con un identificador sintético (correo sin Message-ID propio), no se puede reencolar y no se intenta nada en el buzón', async () => {
    const { service, mailbox, repo } = montar();
    repo.filas.push({
      ...FILA_ERROR,
      messageIdRaw: '<sin-message-id.abc123@buzon-imap.invalid>',
    });

    await expect(service.retry(55, 'tecnico@kuboti.com')).rejects.toThrow(
      /no traía ninguna cabecera Message-ID propia/,
    );
    expect(mailbox.markUnprocessed).not.toHaveBeenCalled();
  });

  /**
   * B4: una fila `ERROR` con `ticketId` puesto es exactamente aquella donde
   * una escritura (el mensaje de un hilo) pudo aterrizar antes de que el
   * proceso fallara -- a diferencia del camino de `TICKET_CREADO`, que solo
   * corrige el `ticketId` de la fila DESPUÉS de que la creación completa del
   * ticket haya tenido éxito. Reencolar arriesgaría duplicar ese mensaje y
   * su aviso al cliente, así que se rechaza sin tocar nada.
   */
  it('una fila ERROR con ticketId ya puesto no se reencola (podría duplicar un mensaje del hilo)', async () => {
    const { service, mailbox, repo } = montar();
    repo.filas.push({ ...FILA_ERROR, ticketId: 501 });

    await expect(service.retry(55, 'tecnico@kuboti.com')).rejects.toThrow(/ya tiene un ticket asociado/);
    expect(mailbox.markUnprocessed).not.toHaveBeenCalled();
  });
});
