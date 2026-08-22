import { Inject, Injectable, Logger } from '@nestjs/common';

import { InboundEmailsRepository } from './inbound-emails.repository';
import { IncomingMessage, Mailbox, MAILBOX } from './mailbox.interface';
import { normalizeMessageId } from './message-id';
import { correlate } from './domain/correlation';
import {
  extractSenderAddress,
  extractTicketCode,
  isAutomaticMessage,
  parseMessageIds,
  stripSubjectPrefixes,
} from './domain/message-headers';
import { isOwnMailbox, judgeAuthentication } from './domain/intake-rules';
import { stripQuotedText } from './domain/quoted-text';
import {
  UNKNOWN_REPLY_COOLDOWN_DAYS,
  hasReachedNewTicketCap,
  shouldReplyToUnknown,
} from './domain/throttle';
import { InboundEmail, InboundEmailOutcome } from './entities/inbound-email.entity';

import { EmailService } from '../email/email.service';
import { ClientUser } from '../portal/entities/client-user.entity';
import { ClientUsersService } from '../portal/client-users.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { CreateTicketDto } from '../tickets/dto/create-ticket.dto';
import { EmailOrigin, TicketsService } from '../tickets/tickets.service';
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
 * espacio de trabajo) la provee aquí, igual que provee `MAILBOX`. Se espera
 * ya como dirección desnuda (sin nombre para mostrar): es un valor de
 * configuración, no una cabecera de correo.
 */
export const INBOUND_MAILBOX_ADDRESS = Symbol('INBOUND_MAILBOX_ADDRESS');

/** Cuántos correos se piden al buzón por pasada. */
export const INBOUND_EMAIL_BATCH_SIZE = 50;

/** Un día y una hora, en milisegundos: lo que hace falta para calcular las ventanas de los dos topes de `domain/throttle.ts`. */
const UN_DIA_EN_MS = 24 * 60 * 60 * 1000;
const UNA_HORA_EN_MS = 60 * 60 * 1000;

/** Lo que hizo una pasada de la ingesta. */
export interface DrainSummary {
  /** Correos que el buzón entregó en esta pasada, se procesaran como se procesaran. */
  fetched: number;
  ticketsCreated: number;
  messagesAdded: number;
  /** Descartados por buzón propio, automático, sin autenticar, Message-ID envenenado o sin contenido. */
  discarded: number;
  /** Autenticados pero de una dirección que no es ni cliente ni personal. */
  unknownSenders: number;
  /** El mismo `Message-ID` ya se había procesado antes: no se repite nada. */
  duplicates: number;
  /** Correos cuyo procesamiento reventó de verdad. Quedan anotados como `ERROR` para poder reintentarlos. */
  errors: number;
}

/** El texto de un error, venga de donde venga. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * El texto de la respuesta a un remitente autenticado pero no registrado
 * (Task 7). Cuatro exigencias, las cuatro deliberadas:
 *
 * - **En español y sin jerga**: quien lo recibe no tiene por qué saber qué es
 *   un ticket, un buzón de ingesta o un `Message-ID`.
 * - **Dice que su dirección no está registrada**, no que "hubo un error": es
 *   accionable, no un genérico "algo salió mal".
 * - **Manda a escribirle a una persona de Kubo, nunca a "su administrador"**:
 *   si la empresa del remitente nunca se dio de alta, ese administrador no
 *   existe del lado de Kubo, y del lado del remitente puede no tener ningún
 *   poder sobre nuestro sistema. Cualquiera de los dos casos deja el mensaje
 *   en un callejón sin salida; "una persona de Kubo" no depende de que la
 *   empresa ya exista en el sistema.
 * - **No cita nada del correo original** (ni el asunto ni el cuerpo): un
 *   buzón que repite de vuelta lo que le mandan es un amplificador -- exacto
 *   el patrón que un ataque de reflexión/spam explota, y exacto lo que
 *   `withAttachmentNote`/`stripQuotedText` evitan en el resto del recorrido
 *   con el contenido de un cliente real.
 *
 * Va marcada como automática (`Auto-Submitted`, ver `handleUnknownSender`)
 * para que un autorespondedor del otro lado no conteste a esto y cierre el
 * bucle -- ese marcado es una propiedad del envío, no del texto, así que no
 * se repite aquí.
 */
function unknownSenderReplyText(): string {
  return (
    'Recibimos tu correo, pero esta dirección no está registrada en nuestro sistema, así que no ' +
    'pudimos abrir un ticket a partir de él.\n\n' +
    'Para poder atenderte por correo, pide a una persona de Kubo que registre tu dirección. ' +
    'En cuanto quede registrada, tu próximo correo desde ella sí abrirá un ticket.'
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
 * El mensaje tal y como llega, con `from` ya reducido a una dirección
 * desnuda (ver el comentario de `IncomingMessage.from`). Se hace **una sola
 * vez**, al principio del recorrido, y todo lo demás -- `isOwnMailbox`, las
 * dos búsquedas de remitente, lo que se guarda en `inbound_emails.from_address`,
 * a quién se le contesta -- lee de aquí. Si se comparara `message.from` sin
 * pasar por esto en cada sitio, un adaptador que entregue
 * `"Ana Quispe" <ana@empresa.com>` -- la forma normal de la cabecera, no un
 * caso raro -- haría fallar abierto `isOwnMailbox` y fallar cerrado las dos
 * búsquedas: todo correo pasaría a ser remitente desconocido.
 */
function withNormalizedFrom(message: IncomingMessage): IncomingMessage {
  return { ...message, from: extractSenderAddress(message.from) };
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
 * nuevo o un mensaje añadido, la fila se reclama **antes** de escribir el
 * ticket o el mensaje -- ver `claim`, más abajo, para el porqué exacto.
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
 * Cada correo del lote se procesa en su propio `try`: un error de verdad se
 * anota como `ERROR` (con su motivo, para poder investigarlo y reintentarlo
 * desde la pantalla de la Task 9) y el siguiente correo se procesa igual. Un
 * correo del personal sin ticket al que corresponder, o una respuesta que
 * queda vacía tras recortar la cita, **no** son un error -- son un desenlace
 * normal, y se descartan como `DESCARTADO_SIN_CONTENIDO` sin lanzar nada:
 * lanzarlos ensuciaría el contador que sirve para detectar problemas de
 * verdad, y la pantalla de reintento los reintentaría para siempre sin que
 * un reintento cambiara nada. El buzón se marca como procesado pase lo que
 * pase -- éxito, descarte o error --, porque ninguno de los tres debe dejar
 * el correo atascado repitiéndose cada minuto.
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

    for (const raw of incoming) {
      // Normalizado una sola vez, al principio: ver `withNormalizedFrom`.
      const message = withNormalizedFrom(raw);

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

    // El espacio de Message-ID no es solo de correos entrantes: también lo
    // usan nuestros propios envíos (`tickets.email_message_id`,
    // `ticket_events.sent_message_id`). Un identificador que ya sostiene un
    // aviso o un ticket propio no puede llegar aquí por casualidad -- los
    // clientes de correo generan los suyos garantizando unicidad global--, así
    // que solo llega si alguien lo reutilizó a propósito (reenviado, copiado
    // de un aviso que vio) para que su correo colisione con un hilo ajeno. Si
    // se aceptara, ese identificador tendría dos "dueños": la próxima
    // respuesta legítima al aviso original resolvería a dos tickets a la vez,
    // `correlate` la trataría como ambigua y abriría un ticket nuevo -- la
    // correlación del hilo real quedaría rota para siempre, no solo para este
    // correo.
    const yaReclamado = await this.repo.findTicketsByEmailMessageIds([messageId]);
    if (yaReclamado.length > 0) {
      await this.discard(
        message,
        messageId,
        'DESCARTADO_DUPLICADO',
        'El Message-ID coincide con uno que ya usamos para un aviso o para abrir un ticket propio: ' +
          'se rechaza para no envenenar la correlación de otro hilo.',
      );
      summary.discarded += 1;
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
    const correlatedTicketId = correlation.kind === 'HILO' ? correlation.ticketId : null;

    // Task 7: el tope de tickets nuevos por dirección y hora
    // (`NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR`) protege contra el correo mal
    // configurado que abre tickets en bucle -- pero **solo** cuando este
    // correo abriría uno nuevo. Comprobarlo también para `correlation.kind
    // === 'HILO'` dejaría mudo, por ese mismo tope, a un cliente con una
    // conversación viva: es justo el caso legítimo que el freno contra el
    // abuso no debe romper.
    if (correlation.kind !== 'HILO') {
      const topeDeTicketsAlcanzado = await this.newTicketCapReached(message.from);
      if (topeDeTicketsAlcanzado) {
        await this.discard(
          message,
          messageId,
          'DESCARTADO_POR_TOPE',
          'Tope de tickets nuevos por dirección y hora.',
          null,
          clientUserId,
        );
        summary.discarded += 1;
        return;
      }
    }

    // El cuerpo recortado (sin la cita del hilo anterior) es lo que se
    // publica; el cuerpo completo se guarda aparte y sin tocar (decisión 7
    // del diseño).
    const strippedBody = stripQuotedText(message.textBody).trim();

    // Un correo normal puede no dejar ningún texto nuevo -- una respuesta que
    // es solo la cita de siempre, o solo una imagen sin una palabra --, y eso
    // no es un fallo del sistema: no hay nada que escribir en ningún lado.
    // Se comprueba antes de intentar nada, no atrapando la excepción que
    // `TicketsService.create`/`TicketMessagesService.post` lanzarían por un
    // cuerpo vacío: eso los habría contado como `ERROR`, con el mismo defecto
    // que el correo del personal sin ticket (ver `handleStaffSender`).
    if (strippedBody.length === 0 && message.attachmentNames.length === 0) {
      await this.discard(
        message,
        messageId,
        'DESCARTADO_SIN_CONTENIDO',
        'La respuesta queda vacía tras recortar la cita del hilo anterior, y no trae ningún adjunto.',
        correlatedTicketId,
        clientUserId,
      );
      summary.discarded += 1;
      return;
    }

    const bodyMd = withAttachmentNote(strippedBody, message.attachmentNames);

    if (correlation.kind === 'HILO') {
      // El ticket ya se conoce: se reclama la fila con él antes de escribir
      // el mensaje (ver `claim`).
      const row = await this.claim(message, messageId, 'MENSAJE_ANADIDO', correlation.ticketId, clientUserId);

      const input: PostMessageInput = {
        bodyMd,
        bodyFull: message.textBody,
        // Forzado, nunca por omisión: un canal externo no escribe notas
        // internas, y `TicketMessagesService.post` respeta este campo para
        // un actor del equipo -- solo lo ignora, e impone PUBLICA, para un
        // actor de cliente. Aquí el actor es de cliente, así que hoy este
        // valor no cambiaría el resultado, pero la regla la sostiene esta
        // afirmación explícita y no esa coincidencia.
        visibility: 'PUBLICA',
      };
      const posted = await this.ticketMessages.post(
        { kind: 'CLIENT', clientUserId, clientId: senderClientId },
        correlation.ticketId,
        input,
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
    //
    // El `ticketId` de la fila reclamada todavía no se conoce -- depende del
    // autoincremental que le va a tocar al ticket --, así que se reclama con
    // `null` y se corrige después de crearlo (ver `claim`).
    const row = await this.claim(message, messageId, 'TICKET_CREADO', null, clientUserId);

    const dto: CreateTicketDto = {
      rawText: bodyMd,
      subject: cleanSubject(message.subject),
      clientId: senderClientId,
      origin: 'EMAIL',
    } as CreateTicketDto;
    const emailOrigin: EmailOrigin = { emailMessageId: messageId, bodyFull: message.textBody };

    const created = await this.tickets.create({ kind: 'CLIENT', clientUserId }, dto, emailOrigin);

    await this.repo.updateOutcome(row.id, { ticketId: Number(created.id) });
    await this.safeAttachInboundEmail(created.firstMessageId, row.id);
    summary.ticketsCreated += 1;
  }

  /**
   * Paso 6 del recorrido, para el personal: su mensaje entra al hilo como
   * mensaje público del equipo, nunca como nota interna -- un canal externo
   * no escribe notas internas, sea cual sea quien lo mande.
   *
   * El personal no crea tickets por correo -- para eso está el panel --, así
   * que si no hay ningún ticket al que corresponder, o si tras recortar la
   * cita no queda ningún texto (y tampoco hay adjuntos), se descarta como
   * `DESCARTADO_SIN_CONTENIDO`: son desenlaces normales, no un fallo, y no
   * deben pasar por `throw` -- eso los contaría como `ERROR` y la pantalla de
   * reintento (Task 9) los reintentaría para siempre sin que un reintento
   * cambiara nada en un correo que seguirá sin ticket o sin texto.
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
      await this.discard(
        message,
        messageId,
        'DESCARTADO_SIN_CONTENIDO',
        'Correo del personal sin ningún ticket al que corresponder ' +
          '(sin cabecera de referencia resuelta, y sin código de ticket propio en el asunto).',
      );
      summary.discarded += 1;
      return;
    }

    const strippedBody = stripQuotedText(message.textBody).trim();
    if (strippedBody.length === 0 && message.attachmentNames.length === 0) {
      await this.discard(
        message,
        messageId,
        'DESCARTADO_SIN_CONTENIDO',
        'El mensaje del personal queda vacío tras recortar la cita del hilo anterior, y no trae ningún adjunto.',
        ticketId,
      );
      summary.discarded += 1;
      return;
    }

    const bodyMd = withAttachmentNote(strippedBody, message.attachmentNames);
    const row = await this.claim(message, messageId, 'MENSAJE_ANADIDO', ticketId, null);

    const input: PostMessageInput = {
      bodyMd,
      bodyFull: message.textBody,
      // Forzado también aquí: un actor STAFF sí respeta `visibility` cuando
      // se le pasa (`input.visibility ?? 'PUBLICA'` en `TicketMessagesService.post`),
      // así que dejarlo sin poner apoyaría la regla en ese valor por omisión
      // en vez de en una afirmación. Este es justo el camino donde eso
      // importa de verdad.
      visibility: 'PUBLICA',
    };
    const posted = await this.ticketMessages.post(
      { kind: 'STAFF', userId: Number(staffUser.id) },
      ticketId,
      input,
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
   * decisión 2 del diseño, se le responde en vez de ignorarlo en silencio --
   * pero como mucho una vez cada `UNKNOWN_REPLY_COOLDOWN_DAYS` días por
   * dirección, y nunca por encima del tope global `UNKNOWN_REPLY_MAX_PER_HOUR`
   * (Task 7, `domain/throttle.ts`). Sin esos dos topes, encender el buzón de
   * verdad (Task 8) regalaría el dominio a cualquier autorespondedor mal
   * configurado que insistiera, o a quien mandara desconocidos a mansalva
   * solo para gastar la reputación del remitente.
   *
   * El registro se escribe primero -- es el descarte ya decidido, pasara lo
   * que pasara con la respuesta -- y la respuesta se intenta después, sin
   * dejar que su fallo se confunda con un fallo del propio procesamiento del
   * correo (por eso su propio `try`, aquí y no en `drain`).
   */
  private async handleUnknownSender(message: IncomingMessage, messageId: string): Promise<void> {
    const permitido = await this.allowedToReplyToUnknown(message.from);
    if (!permitido) {
      await this.discard(
        message,
        messageId,
        'DESCARTADO_POR_TOPE',
        'Tope de respuestas a remitente desconocido: enfriamiento por dirección, tope global por ' +
          'hora, o fallo al comprobarlos.',
      );
      return;
    }

    await this.discard(message, messageId, 'REMITENTE_DESCONOCIDO', null);

    try {
      await this.email.send({
        to: message.from,
        subject: 'No pudimos crear un ticket con tu correo',
        html: `<p>${unknownSenderReplyText().replace('\n\n', '</p><p>')}</p>`,
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

  /**
   * Las dos consultas que sostienen el tope de respuestas a un desconocido
   * (`domain/throttle.ts` decide con lo que aquí se calcula, nunca al
   * revés): cuántas veces ya se respondió a esta misma dirección dentro del
   * enfriamiento, y cuántas se respondió a cualquiera en la última hora.
   *
   * **Fallo cerrado, explícito.** Si cualquiera de las dos consultas
   * revienta, no hay forma de saber si el tope ya se agotó o no -- y "no se
   * pudo saber" nunca es lo mismo que "no hay historial". Se trata como tope
   * alcanzado y no se responde, en vez de decidir por la ausencia del dato
   * en lugar de por el hecho que debía determinarlo (el mismo defecto que
   * tenía el `as Date` sin guarda de
   * `InboundEmailsRepository.countRepliesToUnknown`).
   */
  private async allowedToReplyToUnknown(address: string): Promise<boolean> {
    try {
      const ahora = Date.now();
      const desdeElEnfriamiento = new Date(ahora - UNKNOWN_REPLY_COOLDOWN_DAYS * UN_DIA_EN_MS);
      const desdeHaceUnaHora = new Date(ahora - UNA_HORA_EN_MS);
      const [repliesToAddressInCooldown, repliesGlobalLastHour] = await Promise.all([
        this.repo.countRepliesToUnknown(address, desdeElEnfriamiento),
        this.repo.countRepliesToUnknown(desdeHaceUnaHora),
      ]);
      return shouldReplyToUnknown({ repliesToAddressInCooldown, repliesGlobalLastHour });
    } catch (error) {
      this.logger.warn(
        `No se pudo comprobar el tope de respuestas a desconocidos para ${address}: ${errorText(error)}`,
      );
      return false;
    }
  }

  /**
   * El tope de tickets nuevos por dirección y hora
   * (`NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR`, `domain/throttle.ts`): protege
   * contra un cliente con el correo mal configurado abriendo tickets en
   * bucle. Mismo criterio de fallo cerrado que `allowedToReplyToUnknown`: si
   * la consulta revienta, se trata como si el tope ya se hubiera alcanzado y
   * no se crea el ticket.
   *
   * Quien llama es responsable de no invocar esto para una respuesta que ya
   * correlacionó con un hilo existente -- ver el comentario en
   * `handleClientSender` sobre por qué ese caso no debe pasar por aquí.
   */
  private async newTicketCapReached(address: string): Promise<boolean> {
    try {
      const desdeHaceUnaHora = new Date(Date.now() - UNA_HORA_EN_MS);
      const nuevosEnLaUltimaHora = await this.repo.countNewTicketsByAddress(address, desdeHaceUnaHora);
      return hasReachedNewTicketCap(nuevosEnLaUltimaHora);
    } catch (error) {
      this.logger.warn(
        `No se pudo comprobar el tope de tickets nuevos para ${address}: ${errorText(error)}`,
      );
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // El registro.
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

  /** Un descarte de una sola escritura: se decide y se registra en el mismo paso, sin nada fallible entre medias. */
  private discard(
    message: IncomingMessage,
    messageId: string,
    outcome: InboundEmailOutcome,
    reason: string | null,
    ticketId: number | null = null,
    clientUserId: number | null = null,
  ): Promise<InboundEmail> {
    return this.repo.record({
      ...this.baseRow(message, messageId),
      outcome,
      reason,
      ticketId,
      clientUserId,
    });
  }

  /**
   * Reclama la fila **antes** de escribir el ticket o el mensaje que le
   * corresponde. Es lo que cierra la ventana de atomicidad entre esas dos
   * escrituras -- que viven en transacciones distintas y no se pueden unir
   * sin que `TicketsService`/`TicketMessagesService` dejen de manejar la
   * suya propia (fuera de alcance aquí).
   *
   * Antes de esto, el orden era el contrario -- crear primero, registrar
   * después --, y una caída justo entre medias dejaba un ticket sin fila que
   * lo recordara: al reiniciar, `findByMessageId` seguía dando `null` y el
   * mismo correo creaba un **segundo** ticket. Con la fila reclamada primero,
   * la misma caída deja, en cambio, una fila sin su ticket -- `findByMessageId`
   * ya no da `null`, así que el reinicio no repite el correo -- y el
   * compromiso cambia de signo: se pierde ese correo en vez de duplicar el
   * ticket. Se prefiere perder: duplicar significa un segundo acuse al mismo
   * cliente, y eso sí lo nota quien lo recibe.
   *
   * El `ticketId` puede no conocerse todavía (un ticket nuevo depende del
   * autoincremental que le toque): se reclama con `null` y `handleClientSender`
   * lo corrige con `InboundEmailsRepository.updateOutcome` en cuanto existe.
   * Si la escritura que sigue revienta, `recordError` encuentra esta misma
   * fila (por su `Message-ID`, ya único) y la corrige a `ERROR` -- nunca
   * inserta una segunda, que la clave única rechazaría de todos modos.
   */
  private claim(
    message: IncomingMessage,
    messageId: string,
    outcome: 'TICKET_CREADO' | 'MENSAJE_ANADIDO',
    ticketId: number | null,
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

  /**
   * Dado un fallo de verdad (no un desenlace previsto -- ver `discard`),
   * deja constancia como `ERROR`. Si la fila ya estaba reclamada (`claim`
   * la insertó antes de la escritura que reventó), la corrige; si no había
   * ninguna -- el fallo ocurrió antes de reclamar nada --, inserta una
   * nueva. Nunca las dos cosas: la clave única de `message_id` rechazaría un
   * segundo `INSERT` sobre una fila ya reclamada.
   */
  private async recordError(message: IncomingMessage, error: unknown): Promise<void> {
    const messageId = normalizeMessageId(message.messageId);
    try {
      const existing = await this.repo.findByMessageId(messageId);
      if (existing) {
        await this.repo.updateOutcome(existing.id, { outcome: 'ERROR', reason: errorText(error) });
        return;
      }
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
      await this.ticketMessages.attachInboundEmail(messageId, inboundEmailId);
    } catch (error) {
      this.logger.warn(
        `No se pudo enlazar el mensaje ${messageId} con el correo entrante ${inboundEmailId}: ` +
          errorText(error),
      );
    }
  }
}
