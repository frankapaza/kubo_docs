import { InboundEmailService } from './inbound-email.service';
import { IncomingMessage } from './mailbox.interface';

/**
 * El recorrido completo de un correo, de la bandeja al hilo -- probado sin
 * red ni base de datos de verdad, con un doble trivial de `Mailbox` (la razón
 * de que ese contrato sea tan pequeño, ver su comentario) y dobles de los
 * cuatro servicios de escritura.
 *
 * Los identificadores de empresa y de usuario van como **número** en los
 * dobles de este archivo a propósito -- salvo donde un test concreto necesita
 * lo contrario --, porque lo que hay que probar aquí es el recorrido de
 * negocio; la asimetría `number`/cadena que exige `sameId` ya está probada a
 * fondo en `correlation.spec.ts` y no hace falta repetirla en cada test de
 * este archivo.
 */

const BUZON_PROPIO = 'ticket@kuboti.com';

/** Un correo de ejemplo, ya autenticado y sin ninguna de las señales de descarte. */
function unMensaje(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    mailboxRef: 'uid-1',
    messageId: '<msg-1@empresa.com>',
    from: 'ana@empresa.com',
    subject: 'No carga el reporte',
    sentAt: new Date('2026-08-20T10:00:00Z'),
    textBody: 'Hola, el reporte de ventas no carga desde ayer.',
    headers: {},
    authenticationResults: 'mx.kuboti.com; dmarc=pass',
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
  };
}

/** Doble de `InboundEmailsRepository`, con `record` devolviendo ids incrementales. */
function repoDoble() {
  let siguienteId = 1;
  return {
    findByMessageId: jest.fn().mockResolvedValue(null),
    record: jest.fn((fila: Record<string, unknown>) =>
      Promise.resolve({ id: siguienteId++, ...fila }),
    ),
    findTicketByCode: jest.fn().mockResolvedValue(null),
    findTicketsByEmailMessageIds: jest.fn().mockResolvedValue([]),
    countRepliesToUnknown: jest.fn(),
  };
}

interface Opciones {
  mensajes?: IncomingMessage[];
  clientUser?: typeof CLIENT_USER | null;
  staffUser?: typeof STAFF_USER | null;
  crearTicketImpl?: (...args: unknown[]) => Promise<unknown>;
  postMensajeImpl?: (...args: unknown[]) => Promise<unknown>;
}

function montar(opciones: Opciones = {}) {
  const {
    mensajes = [unMensaje()],
    clientUser = null,
    staffUser = null,
    crearTicketImpl,
    postMensajeImpl,
  } = opciones;

  const mailbox = mailboxDoble(mensajes);
  const repo = repoDoble();
  const ticketMessagesRepo = { attachInboundEmail: jest.fn().mockResolvedValue(undefined) };
  const tickets = {
    create: crearTicketImpl
      ? jest.fn(crearTicketImpl)
      : jest.fn().mockResolvedValue(unTicketCreado()),
  };
  const ticketMessages = {
    post: postMensajeImpl
      ? jest.fn(postMensajeImpl)
      : jest.fn().mockResolvedValue(unMensajePosteado()),
  };
  const clientUsers = { findByEmail: jest.fn().mockResolvedValue(clientUser) };
  const users = { findByEmail: jest.fn().mockResolvedValue(staffUser) };
  const email = {
    send: jest.fn().mockResolvedValue({ messageId: '<respuesta@kuboti.com>', accepted: [], rejected: [] }),
  };

  const service = new InboundEmailService(
    mailbox as any,
    BUZON_PROPIO,
    repo as any,
    ticketMessagesRepo as any,
    tickets as any,
    ticketMessages as any,
    clientUsers as any,
    users as any,
    email as any,
  );

  return { service, mailbox, repo, ticketMessagesRepo, tickets, ticketMessages, clientUsers, users, email };
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

      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'TICKET_CREADO', ticketId: 501, clientUserId: 11 }),
      );
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
      repo.findTicketsByEmailMessageIds.mockResolvedValueOnce([{ ticketId: 501, clientId: 7 }]);

      const resumen = await service.drain();

      expect(ticketMessages.post).toHaveBeenCalledTimes(1);
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.messagesAdded).toBe(1);
      expect(resumen.ticketsCreated).toBe(0);
      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'MENSAJE_ANADIDO', ticketId: 501, clientUserId: 11 }),
      );
    });

    it('el mensaje añadido lleva el clientUserId del remitente, y ninguna visibilidad explícita', async () => {
      const { service, repo, ticketMessages } = montarRespuesta();
      repo.findTicketsByEmailMessageIds.mockResolvedValueOnce([{ ticketId: 501, clientId: 7 }]);

      await service.drain();

      const [actor, ticketId, input] = ticketMessages.post.mock.calls[0];
      expect(actor).toEqual({ kind: 'CLIENT', clientUserId: 11, clientId: 7 });
      expect(ticketId).toBe(501);
      // Nunca se pide una visibilidad concreta: `TicketMessagesService.post`
      // es quien decide, y para un actor de cliente siempre es PUBLICA. Pasar
      // aquí `visibility` sería abrir, por este canal, la puerta que la regla
      // "un canal externo nunca escribe notas internas" tiene que mantener
      // cerrada sin excepción y sin parámetro que la cambie.
      expect(input.visibility).toBeUndefined();
      expect(input.bodyMd).toContain('sigue igual');
    });
  });

  // -------------------------------------------------------------------------
  // Correo del personal.
  // -------------------------------------------------------------------------

  describe('un correo del personal', () => {
    it('añade un mensaje público del equipo, con authorUserId', async () => {
      const { service, repo, ticketMessages, tickets } = montar({
        staffUser: STAFF_USER,
        mensajes: [unMensaje({ from: 'tecnico@kuboti.com', subject: 'Re: [KB-0501] No carga el reporte' })],
      });
      repo.findTicketByCode.mockResolvedValueOnce({ id: 501, clientId: 7 });

      const resumen = await service.drain();

      expect(ticketMessages.post).toHaveBeenCalledTimes(1);
      const [actor, ticketId] = ticketMessages.post.mock.calls[0];
      expect(actor).toEqual({ kind: 'STAFF', userId: 5 });
      expect(ticketId).toBe(501);
      expect(tickets.create).not.toHaveBeenCalled();
      expect(resumen.messagesAdded).toBe(1);
      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'MENSAJE_ANADIDO', clientUserId: null }),
      );
    });

    it('un correo del personal sin ningún ticket identificable se registra como ERROR, no se pierde en silencio', async () => {
      const { service, repo, ticketMessages } = montar({
        staffUser: STAFF_USER,
        mensajes: [unMensaje({ from: 'tecnico@kuboti.com', subject: 'Consulta interna' })],
      });

      const resumen = await service.drain();

      expect(ticketMessages.post).not.toHaveBeenCalled();
      expect(resumen.errors).toBe(1);
      expect(repo.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ERROR' }));
    });
  });

  // -------------------------------------------------------------------------
  // Los descartes que nunca responden.
  // -------------------------------------------------------------------------

  describe('los descartes', () => {
    it('sin cabecera de autenticación: DESCARTADO_NO_AUTENTICADO y no se responde', async () => {
      const { service, repo, email, tickets, ticketMessages } = montar({
        mensajes: [unMensaje({ authenticationResults: null })],
      });

      const resumen = await service.drain();

      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'DESCARTADO_NO_AUTENTICADO' }),
      );
      expect(email.send).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
      expect(ticketMessages.post).not.toHaveBeenCalled();
      expect(resumen.discarded).toBe(1);
    });

    it('con autenticación fallida: igual DESCARTADO_NO_AUTENTICADO y no se responde', async () => {
      const { service, repo, email } = montar({
        mensajes: [unMensaje({ authenticationResults: 'mx.kuboti.com; dmarc=fail' })],
      });

      await service.drain();

      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'DESCARTADO_NO_AUTENTICADO' }),
      );
      expect(email.send).not.toHaveBeenCalled();
    });

    it('un correo automático: DESCARTADO_AUTOMATICO y no se responde', async () => {
      const { service, repo, email } = montar({
        mensajes: [unMensaje({ headers: { 'list-id': '<lista.empresa.com>' } })],
      });

      await service.drain();

      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'DESCARTADO_AUTOMATICO' }),
      );
      expect(email.send).not.toHaveBeenCalled();
    });

    it('un correo del propio buzón: DESCARTADO_PROPIO', async () => {
      const { service, repo, email } = montar({
        mensajes: [unMensaje({ from: BUZON_PROPIO })],
      });

      await service.drain();

      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'DESCARTADO_PROPIO' }),
      );
      expect(email.send).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Idempotencia: el mismo Message-ID no se procesa dos veces.
  // -------------------------------------------------------------------------

  it('el mismo Message-ID dos veces se procesa una sola vez', async () => {
    const { service, repo, tickets, mailbox } = montar({ clientUser: CLIENT_USER });

    await service.drain();
    expect(tickets.create).toHaveBeenCalledTimes(1);

    // Segunda pasada: el correo sigue en el buzón (p. ej. `markProcessed`
    // falló la vez anterior) y ahora `findByMessageId` sí lo encuentra.
    repo.findByMessageId.mockResolvedValueOnce({ id: 1, messageId: '<msg-1@empresa.com>' } as never);
    const resumen = await service.drain();

    expect(tickets.create).toHaveBeenCalledTimes(1);
    expect(resumen.duplicates).toBe(1);
    // Y se sigue intentando marcar: es lo que permite que, si ahora sí
    // funciona, deje de reaparecer en las pasadas siguientes.
    expect(mailbox.markProcessed).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Remitente desconocido.
  // -------------------------------------------------------------------------

  describe('un remitente desconocido', () => {
    it('se responde una vez y se registra REMITENTE_DESCONOCIDO', async () => {
      const { service, repo, email } = montar({ mensajes: [unMensaje({ from: 'nadie@fuera.com' })] });

      const resumen = await service.drain();

      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'REMITENTE_DESCONOCIDO' }),
      );
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(email.send.mock.calls[0][0].to).toBe('nadie@fuera.com');
      expect(resumen.unknownSenders).toBe(1);
    });

    it('el registro se escribe antes de intentar la respuesta', async () => {
      const { service, repo, email } = montar({ mensajes: [unMensaje({ from: 'nadie@fuera.com' })] });

      await service.drain();

      const ordenRegistro = repo.record.mock.invocationCallOrder[0];
      const ordenRespuesta = email.send.mock.invocationCallOrder[0];
      expect(ordenRegistro).toBeLessThan(ordenRespuesta);
    });

    it('un usuario de cliente desactivado también cuenta como desconocido', async () => {
      const { service, repo, email } = montar({
        clientUser: { ...CLIENT_USER, isActive: 0 },
      });

      await service.drain();

      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'REMITENTE_DESCONOCIDO' }),
      );
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
    expect(repo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'ERROR',
        messageIdRaw: '<falla@empresa.com>',
        reason: expect.stringContaining('la base de datos no responde'),
      }),
    );
    expect(repo.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'TICKET_CREADO', messageIdRaw: '<bien@empresa.com>' }),
    );
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

      expect(repo.record).toHaveBeenCalledWith(
        expect.objectContaining({
          attachmentCount: 2,
          attachmentNames: ['factura.pdf', 'foto.png'],
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // El enlace entre el mensaje y su correo de origen (informativo).
  // -------------------------------------------------------------------------

  it('enlaza el primer mensaje del ticket con la fila de inbound_emails que lo originó', async () => {
    const { service, ticketMessagesRepo } = montar({ clientUser: CLIENT_USER });

    await service.drain();

    expect(ticketMessagesRepo.attachInboundEmail).toHaveBeenCalledWith(9001, 1);
  });

  it('un fallo al enlazar el mensaje no tira el resto: el ticket ya está escrito', async () => {
    const { service, ticketMessagesRepo, repo } = montar({ clientUser: CLIENT_USER });
    ticketMessagesRepo.attachInboundEmail.mockRejectedValueOnce(new Error('fallo de red'));

    const resumen = await service.drain();

    expect(resumen.errors).toBe(0);
    expect(resumen.ticketsCreated).toBe(1);
    expect(repo.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'TICKET_CREADO' }));
  });
});
