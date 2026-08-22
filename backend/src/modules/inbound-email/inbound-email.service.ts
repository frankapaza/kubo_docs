import { Inject, Injectable, Logger } from '@nestjs/common';

import { InboundEmailsRepository } from './inbound-emails.repository';
import { IncomingMessage, Mailbox, MAILBOX } from './mailbox.interface';
import { normalizeMessageId } from './message-id';
import { correlate } from './domain/correlation';
import {
  extractTicketCode,
  isAutomaticMessage,
  parseMessageIds,
  stripSubjectPrefixes,
} from './domain/message-headers';
import { isOwnMailbox, judgeAuthentication } from './domain/intake-rules';
import { stripQuotedText } from './domain/quoted-text';
import { InboundEmail, InboundEmailOutcome } from './entities/inbound-email.entity';

import { EmailService } from '../email/email.service';
import { ClientUser } from '../portal/entities/client-user.entity';
import { ClientUsersService } from '../portal/client-users.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { CreateTicketDto } from '../tickets/dto/create-ticket.dto';
import { EmailOrigin, TicketsService } from '../tickets/tickets.service';
import { TicketMessagesRepository } from '../ticket-messages/ticket-messages.repository';
import { PostMessageInput, TicketMessagesService } from '../ticket-messages/ticket-messages.service';

/**
 * Token de inyección para la dirección del propio buzón (p. ej.
 * `ticket@kuboti.com`), la que `isOwnMailbox` usa para no crear un ticket a
 * partir de un acuse que el propio sistema mandó y que un reenvío o una
 * regla de copia le devolvió.
 *
 * No es un valor fijo en el código: `Mailbox` (este servicio, `./mailbox.interface.ts`)
 * es deliberadamente pequeño y no expone su propia dirección, así que quien
 * arme el módulo de verdad (Task 8, con el buzón IMAP y sus ajustes del
 * espacio de trabajo) la provee aquí, igual que provee `MAILBOX`.
 */
export const INBOUND_MAILBOX_ADDRESS = Symbol('INBOUND_MAILBOX_ADDRESS');

/** Cuántos correos se piden al buzón por pasada. */
export const INBOUND_EMAIL_BATCH_SIZE = 50;

/** Lo que hizo una pasada de la ingesta. */
export interface DrainSummary {
  /** Correos que el buzón entregó en esta pasada, se procesaran como se procesaran. */
  fetched: number;
  ticketsCreated: number;
  messagesAdded: number;
  /** Descartados por venir del propio buzón, ser automáticos o no autenticar. */
  discarded: number;
  /** Autenticados pero de una dirección que no es ni cliente ni personal. */
  unknownSenders: number;
  /** El mismo `Message-ID` ya se había procesado antes: no se repite nada. */
  duplicates: number;
  /** Correos cuyo procesamiento reventó. Quedan anotados como `ERROR` para poder reintentarlos. */
  errors: number;
}

/** El texto de un error, venga de donde venga. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * El texto de la respuesta a un remitente autenticado pero no registrado.
 *
 * **Provisional**: la Task 7 (los topes y la respuesta al desconocido) es la
 * dueña de esta redacción y del freno de cuántas veces se manda -- una por
 * dirección cada varios días, un tope global por hora. Aquí solo se cierra el
 * hueco que dejaría "autenticado pero desconocido" sin ninguna respuesta, que
 * es peor que un texto genérico: la decisión 2 del diseño exige que no se
 * ignore en silencio.
 */
function unknownSenderReplyText(): string {
  return (
    'Recibimos tu correo, pero tu dirección no está registrada como usuario en nuestro sistema, ' +
    'así que no pudimos abrir un ticket a partir de él. Escríbenos desde la dirección con la que ' +
    'trabajas con nosotros, o pide que un miembro de nuestro equipo la dé de alta.'
  );
}

/** Cómo queda el cuerpo del mensaje cuando el correo traía adjuntos. */
function withAttachmentNote(body: string, attachmentNames: string[]): string {
  if (attachmentNames.length === 0) return body;

  const lista = attachmentNames.join(', ');
  const nota =
    attachmentNames.length === 1
      ? `Este correo traía un adjunto (${lista}). No se descarga automáticamente: pídelo aparte.`
      : `Este correo traía ${attachmentNames.length} adjuntos (${lista}). No se descargan automáticamente: pídelos aparte.`;

  return `${body}\n\n${nota}`;
}

/** El asunto ya sin `Re:`/`Fwd:` acumulados, o `undefined` si no queda nada útil. */
function cleanSubject(subject: string | null): string | undefined {
  if (subject === null) return undefined;
  const cleaned = stripSubjectPrefixes(subject).trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Los identificadores de `In-Reply-To`/`References`, ya normalizados para consultar la base. */
function headerMessageIds(message: IncomingMessage): string[] {
  const inReplyTo = message.headers['in-reply-to'] ?? null;
  const references = message.headers['references'] ?? null;
  return [...parseMessageIds(inReplyTo), ...parseMessageIds(references)].map(normalizeMessageId);
}

/**
 * El recorrido completo de un correo, de la bandeja al hilo. Es el corazón
 * del proyecto: ejecuta, en orden, los ocho pasos de la especificación
 * (`docs/superpowers/specs/2026-08-22-tickets-por-correo-design.md`, sección
 * "El recorrido de un correo"), y **cada descarte se registra con su
 * motivo**, siempre, antes de responder nada.
 *
 * ## El registro se escribe siempre, y antes de responder nada
 *
 * `InboundEmailsRepository.record` se llama en cada camino -- ticket creado,
 * mensaje añadido, cualquier descarte, remitente desconocido -- y **antes**
 * de cualquier efecto hacia fuera. Para el remitente desconocido eso es
 * literal: se registra y solo entonces se manda la respuesta. Para un ticket
 * nuevo, el acuse con el número no lo manda este servicio -- ver más abajo --
 * así que aquí "antes de responder" es, sobre todo, la garantía de que nada
 * más se intenta con este correo hasta que su fila exista.
 *
 * La clave única de `inbound_emails.message_id` es lo que sostiene la
 * idempotencia real: si el proceso muere entre crear el ticket y llamar a
 * `record`, el reinicio reprocesará el mismo `Message-ID` y creará un
 * **segundo** ticket, porque `TicketsService.create` confirma su propia
 * transacción antes de que este servicio pueda escribir la fila que lo
 * impediría -- no hay manera de unir las dos escrituras sin que
 * `TicketsService`/`TicketMessagesService` dejen de manejar su propia
 * transacción, y ese cambio no es de esta tarea. Es una ventana estrecha (dos
 * sentencias seguidas, sin ningún `await` de red entre medias) y el mismo
 * compromiso que ya acepta `NotificationScheduler` en su propio "no hay
 * exactamente una vez" -- pero es real, y se deja escrito aquí para que quien
 * revise lo pueda evaluar y no lo confunda con un descuido.
 *
 * ## Por qué el acuse de un ticket nuevo no lo manda este servicio
 *
 * El diseño lo deja fuera de alcance a propósito ("Responder al cliente
 * desde el correo entrante... las respuestas del equipo salen por donde ya
 * salen: las plantillas de notificación"). `TicketsService.create` ya escribe
 * el evento `CREATED` dentro de su propia transacción, y `plansForEvent` ya
 * sabe mandar `TICKET_CREATED` al cliente con su código -- `NotificationScheduler`
 * lo drena en el minuto siguiente. Duplicar ese envío aquí sería un segundo
 * camino para el mismo correo, con su propia plantilla y su propia lista de
 * variables a mantener sincronizada. La única respuesta que **sí** sale de
 * aquí es la del remitente desconocido, porque ahí no hay ticket ni evento
 * del que colgarla.
 *
 * ## Un correo roto no para a los demás
 *
 * Cada correo del lote se procesa en su propio `try`: un error se anota como
 * `ERROR` (con su motivo, para poder investigarlo y reintentarlo desde la
 * pantalla de la Task 9) y el siguiente correo se procesa igual. El buzón se
 * marca como procesado pase lo que pase -- éxito, descarte o error --, porque
 * ninguno de los tres debe dejar el correo atascado repitiéndose cada minuto.
 *
 * ## A lo que no autentica no se le responde nunca
 *
 * Ni una nota en el log dirigida al remitente, ni un ticket, ni un reintento
 * con otra dirección: un correo sin `dmarc=pass` en la cabecera más externa
 * se descarta en silencio. Contestarle a un remitente falsificado es
 * escribirle a la víctima cuya dirección usó.
 */
@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);

  constructor(
    @Inject(MAILBOX) private readonly mailbox: Mailbox,
    @Inject(INBOUND_MAILBOX_ADDRESS) private readonly mailboxAddress: string,
    private readonly repo: InboundEmailsRepository,
    private readonly ticketMessagesRepo: TicketMessagesRepository,
    private readonly tickets: TicketsService,
    private readonly ticketMessages: TicketMessagesService,
    private readonly clientUsers: ClientUsersService,
    private readonly users: UsersService,
    private readonly email: EmailService,
  ) {}

  async drain(limit: number = INBOUND_EMAIL_BATCH_SIZE): Promise<DrainSummary> {
    const incoming = await this.mailbox.fetchUnprocessed(limit);
    const summary: DrainSummary = {
      fetched: incoming.length,
      ticketsCreated: 0,
      messagesAdded: 0,
      discarded: 0,
      unknownSenders: 0,
      duplicates: 0,
      errors: 0,
    };

    for (const message of incoming) {
      try {
        await this.processOne(message, summary);
      } catch (error) {
        summary.errors += 1;
        this.logger.error(
          `Fallo al procesar el correo ${message.mailboxRef} (Message-ID crudo "${message.messageId}"): ` +
            errorText(error),
        );
        await this.recordError(message, error);
      }

      // Se marca procesado pase lo que pase: un fallo (de negocio o de
      // marcado en sí) no puede dejar el correo repitiéndose cada pasada. Un
      // fallo del propio `markProcessed` solo se registra en el log -- no hay
      // nada más que hacer con él aquí, y no debe impedir que el resto del
      // lote se marque.
      try {
        await this.mailbox.markProcessed(message.mailboxRef);
      } catch (markError) {
        this.logger.error(
          `No se pudo marcar como procesado el correo ${message.mailboxRef}: ${errorText(markError)}`,
        );
      }
    }

    return summary;
  }

  /**
   * Decide qué hacer con un correo y lo hace. No captura nada: un fallo aquí
   * sube tal cual hasta `drain`, que lo registra como `ERROR` y sigue con el
   * siguiente correo del lote.
   */
  private async processOne(message: IncomingMessage, summary: DrainSummary): Promise<void> {
    const messageId = normalizeMessageId(message.messageId);

    // Paso 2 del recorrido: si ya se procesó, no se repite nada -- ni el
    // ticket, ni el registro (la clave única lo impediría igualmente), ni una
    // respuesta. Puede llegar aquí un correo que el buzón ya entregó antes
    // porque `markProcessed` falló la vez anterior: por eso el bucle de
    // `drain` sigue intentando marcarlo aunque este método no haga nada más.
    const yaProcesado = await this.repo.findByMessageId(messageId);
    if (yaProcesado) {
      summary.duplicates += 1;
      return;
    }

    // Paso 3: nunca un acuse propio que volvió a entrar.
    if (isOwnMailbox(message.from, this.mailboxAddress)) {
      await this.discard(message, messageId, 'DESCARTADO_PROPIO', null);
      summary.discarded += 1;
      return;
    }

    // Paso 4: vacaciones, listas de correo, respuestas automáticas. Nunca se
    // responde -- es lo que corta el bucle de acuses.
    if (isAutomaticMessage(message.headers)) {
      await this.discard(message, messageId, 'DESCARTADO_AUTOMATICO', null);
      summary.discarded += 1;
      return;
    }

    // Paso 5: sin autenticación no hay garantía de quién lo mandó. Se
    // descarta en silencio -- contestar sería escribirle a la víctima de una
    // suplantación, no al remitente real.
    const authVerdict = judgeAuthentication(message.authenticationResults);
    if (authVerdict !== 'PASA') {
      await this.discard(
        message,
        messageId,
        'DESCARTADO_NO_AUTENTICADO',
        `Autenticación: ${authVerdict}.`,
      );
      summary.discarded += 1;
      return;
    }

    // Paso 6: el remitente tiene que ser alguien conocido. Primero un usuario
    // de cliente -- es el caso que abre o alimenta tickets --, y solo si no
    // lo es, personal del equipo. El orden no es arbitrario: una dirección no
    // puede ser las dos cosas a la vez, pero mirar primero al cliente es
    // mirar primero el camino que de verdad importa (crear el ticket).
    const clientUser = await this.clientUsers.findByEmail(message.from);
    if (clientUser && clientUser.isActive) {
      await this.handleClientSender(message, messageId, clientUser, summary);
      return;
    }

    const staffUser = await this.users.findByEmail(message.from);
    if (staffUser && staffUser.isActive) {
      await this.handleStaffSender(message, messageId, staffUser, summary);
      return;
    }

    await this.handleUnknownSender(message, messageId);
    summary.unknownSenders += 1;
  }

  // ---------------------------------------------------------------------------
  // Los tres remitentes posibles, una vez que autenticó.
  // ---------------------------------------------------------------------------

  /**
   * Paso 7 del recorrido, para un usuario de cliente: se correlaciona con un
   * ticket existente y, si no hay, se crea uno nuevo. El `clientId` que
   * decide de quién es el ticket sale **siempre** de `clientUser`, nunca de
   * nada que venga dentro del correo -- ver `correlate` y su comentario sobre
   * la frontera entre empresas.
   */
  private async handleClientSender(
    message: IncomingMessage,
    messageId: string,
    clientUser: ClientUser,
    summary: DrainSummary,
  ): Promise<void> {
    const senderClientId = Number(clientUser.clientId);
    const clientUserId = Number(clientUser.id);

    const headerIds = headerMessageIds(message);
    const byMessageId = await this.repo.findTicketsByEmailMessageIds(headerIds);
    const code = message.subject !== null ? extractTicketCode(message.subject) : null;
    const ticketByCode = code !== null ? await this.repo.findTicketByCode(code) : null;
    const byCode = ticketByCode
      ? { ticketId: ticketByCode.id, clientId: ticketByCode.clientId }
      : null;

    const correlation = correlate({
      inReplyTo: message.headers['in-reply-to'] ?? null,
      references: message.headers['references'] ?? null,
      subject: message.subject,
      byMessageId,
      byCode,
      senderClientId,
    });

    // El cuerpo recortado (sin la cita del hilo anterior) es lo que se
    // publica; el cuerpo completo se guarda aparte y sin tocar (decisión 7
    // del diseño). La nota de adjuntos va solo en el recortado: es
    // información nueva para quien atiende, no algo que el cliente escribió.
    const bodyMd = withAttachmentNote(stripQuotedText(message.textBody), message.attachmentNames);

    if (correlation.kind === 'HILO') {
      const input: PostMessageInput = { bodyMd, bodyFull: message.textBody };
      const posted = await this.ticketMessages.post(
        { kind: 'CLIENT', clientUserId, clientId: senderClientId },
        correlation.ticketId,
        input,
      );

      const row = await this.recordSuccess(
        message,
        messageId,
        'MENSAJE_ANADIDO',
        Number(posted.ticket.id),
        clientUserId,
      );
      await this.safeAttachInboundEmail(posted.message.id, row.id);
      summary.messagesAdded += 1;
      return;
    }

    // Sin ticket que continuar (`NUEVO`, sea cual sea el motivo -- incluida
    // la referencia de otra empresa): se crea uno, siempre de la empresa del
    // remitente. Es la prueba que cierra el proyecto: un correo con el
    // código de un ticket ajeno en el asunto no toca ese ticket, abre uno
    // nuevo y propio.
    const dto: CreateTicketDto = {
      rawText: bodyMd,
      subject: cleanSubject(message.subject),
      clientId: senderClientId,
      origin: 'EMAIL',
    } as CreateTicketDto;
    const emailOrigin: EmailOrigin = { emailMessageId: messageId, bodyFull: message.textBody };

    const created = await this.tickets.create({ kind: 'CLIENT', clientUserId }, dto, emailOrigin);

    const row = await this.recordSuccess(
      message,
      messageId,
      'TICKET_CREADO',
      Number(created.id),
      clientUserId,
    );
    await this.safeAttachInboundEmail(created.firstMessageId, row.id);
    summary.ticketsCreated += 1;
  }

  /**
   * Paso 6 del recorrido, para el personal: su mensaje entra al hilo como
   * mensaje público del equipo, nunca como nota interna -- un canal externo
   * no escribe notas internas, sea cual sea quien lo mande.
   *
   * El personal no crea tickets por correo -- para eso está el panel --, así
   * que si no hay ningún ticket al que corresponder, se deja subir el error:
   * `drain` lo anota como `ERROR`, visible y reintentable, en vez de un
   * descarte silencioso que escondería un correo del equipo que se perdió.
   *
   * La correlación aquí **no** pasa por `correlate`: esa función existe para
   * sostener la frontera entre empresas, y el personal no tiene una empresa
   * de la que defenderse. Si su correo referencia un ticket por cabecera, ese
   * ticket es el correcto sin más comprobación -- el mismo criterio con el
   * que ya puede escribir en cualquier ticket desde el panel.
   */
  private async handleStaffSender(
    message: IncomingMessage,
    messageId: string,
    staffUser: User,
    summary: DrainSummary,
  ): Promise<void> {
    const ticketId = await this.resolveStaffTicket(message);
    if (ticketId === null) {
      throw new Error(
        'Correo del personal sin ningún ticket al que corresponder ' +
          '(sin cabecera de referencia resuelta, y sin código de ticket propio en el asunto).',
      );
    }

    const bodyMd = withAttachmentNote(stripQuotedText(message.textBody), message.attachmentNames);
    const input: PostMessageInput = { bodyMd, bodyFull: message.textBody };
    const posted = await this.ticketMessages.post(
      { kind: 'STAFF', userId: Number(staffUser.id) },
      ticketId,
      input,
    );

    const row = await this.recordSuccess(
      message,
      messageId,
      'MENSAJE_ANADIDO',
      Number(posted.ticket.id),
      null,
    );
    await this.safeAttachInboundEmail(posted.message.id, row.id);
    summary.messagesAdded += 1;
  }

  /** El ticket al que corresponde el correo de un miembro del personal, o `null` si no hay ninguno. */
  private async resolveStaffTicket(message: IncomingMessage): Promise<number | null> {
    const headerIds = headerMessageIds(message);
    if (headerIds.length > 0) {
      const matches = await this.repo.findTicketsByEmailMessageIds(headerIds);
      const distinctTicketIds = [...new Set(matches.map((m) => Number(m.ticketId)))];
      if (distinctTicketIds.length === 1) return distinctTicketIds[0];
    }

    const code = message.subject !== null ? extractTicketCode(message.subject) : null;
    if (code === null) return null;
    const ticket = await this.repo.findTicketByCode(code);
    return ticket ? Number(ticket.id) : null;
  }

  /**
   * Paso 6 del recorrido cuando la dirección no es de nadie conocido:
   * decisión 2 del diseño, se le responde una vez en vez de ignorarlo en
   * silencio. El registro se escribe primero -- es el descarte ya decidido,
   * pasara lo que pasara con la respuesta -- y la respuesta se intenta
   * después, sin dejar que su fallo se confunda con un fallo del propio
   * procesamiento del correo (por eso su propio `try`, aquí y no en `drain`).
   */
  private async handleUnknownSender(message: IncomingMessage, messageId: string): Promise<void> {
    await this.discard(message, messageId, 'REMITENTE_DESCONOCIDO', null);

    try {
      await this.email.send({
        to: message.from,
        subject: 'No pudimos crear un ticket con tu correo',
        html: `<p>${unknownSenderReplyText()}</p>`,
        text: unknownSenderReplyText(),
        // Marcado como automático (RFC 3834) para que un autorespondedor del
        // otro lado no nos conteste y forme, con esto, un bucle de acuses.
        headers: { 'Auto-Submitted': 'auto-generated' },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo responder al remitente desconocido ${message.from}: ${errorText(error)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // El registro. Se llama siempre, y antes de cualquier otro efecto -- ver el
  // docblock de la clase.
  // ---------------------------------------------------------------------------

  private baseRow(message: IncomingMessage, messageId: string): Partial<InboundEmail> {
    return {
      messageId,
      messageIdRaw: message.messageId,
      fromAddress: message.from,
      subject: message.subject,
      sentAt: message.sentAt,
      receivedAt: new Date(),
      attachmentCount: message.attachmentNames.length,
      attachmentNames: message.attachmentNames.length > 0 ? message.attachmentNames : null,
    };
  }

  private discard(
    message: IncomingMessage,
    messageId: string,
    outcome: InboundEmailOutcome,
    reason: string | null,
  ): Promise<InboundEmail> {
    return this.repo.record({
      ...this.baseRow(message, messageId),
      outcome,
      reason,
      ticketId: null,
      clientUserId: null,
    });
  }

  private recordSuccess(
    message: IncomingMessage,
    messageId: string,
    outcome: 'TICKET_CREADO' | 'MENSAJE_ANADIDO',
    ticketId: number,
    clientUserId: number | null,
  ): Promise<InboundEmail> {
    return this.repo.record({
      ...this.baseRow(message, messageId),
      outcome,
      reason: null,
      ticketId,
      clientUserId,
    });
  }

  private async recordError(message: IncomingMessage, error: unknown): Promise<void> {
    const messageId = normalizeMessageId(message.messageId);
    try {
      await this.repo.record({
        ...this.baseRow(message, messageId),
        outcome: 'ERROR',
        reason: errorText(error),
        ticketId: null,
        clientUserId: null,
      });
    } catch (recordError) {
      // Ni siquiera el registro del error se pudo escribir. No hay nada más
      // que intentar: se deja constancia en el log y el correo se marcará
      // procesado igual (ver `drain`), porque insistir en cada pasada no lo
      // arregla y sí atasca la cabeza de la cola.
      this.logger.error(
        `No se pudo registrar el fallo del correo ${message.mailboxRef}: ${errorText(recordError)} ` +
          `(motivo original: ${errorText(error)}).`,
      );
    }
  }

  /**
   * Enlaza el mensaje recién escrito con la fila de `inbound_emails` que lo
   * originó (`ticket_messages.inbound_email_id`). Es puramente informativo --
   * de qué correo salió este mensaje del hilo --, así que un fallo aquí no
   * puede tirar todo lo demás: el ticket y el mensaje ya están escritos y son
   * lo que de verdad importa.
   */
  private async safeAttachInboundEmail(messageId: number, inboundEmailId: number): Promise<void> {
    try {
      await this.ticketMessagesRepo.attachInboundEmail(messageId, inboundEmailId);
    } catch (error) {
      this.logger.warn(
        `No se pudo enlazar el mensaje ${messageId} con el correo entrante ${inboundEmailId}: ` +
          errorText(error),
      );
    }
  }
}
