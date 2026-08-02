import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClientsRepository } from '../clients/clients.repository';
import { EmailService } from '../email/email.service';
import { ClientUsersRepository } from '../portal/client-users.repository';
import { TicketEvent } from '../tickets/entities/ticket-event.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TICKET_STATUS_LABELS, TicketStatus } from '../tickets/domain/ticket-state-machine';
import { UsersService } from '../users/users.service';
import { TicketsRepository } from '../tickets/tickets.repository';
import { WorkspaceService } from '../workspace/workspace.service';

import { NotificationPlanEntry, plansForEvent } from './domain/notification-rules';
import {
  ClientVariable,
  NotificationAudience,
  TeamVariable,
  render,
} from './domain/template-renderer';
import { NotificationTemplate } from './entities/notification-template.entity';
import { NotificationTemplatesService } from './notification-templates.service';

/**
 * Resultado de despachar un evento. `skipped` no es un error: es la razón, en
 * español, por la que uno o más avisos no salieron (no había plantilla activa,
 * no había a quién escribir, el evento no genera avisos). El vigilante de la
 * tarea siguiente la guarda para poder mirarla, y sella la fila igualmente.
 */
export interface DispatchResult {
  sent: number;
  skipped: string | null;
}

/** URL base del frontend cuando no hay `FRONTEND_URL`; misma que usa el envío de firmas. */
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

/** Cómo se ve un dato que falta en el correo del equipo. Nunca la llave cruda. */
const SIN_RESPONSABLE = 'Sin asignar';

/**
 * El estado en español. El `?? null` no es redundante aunque el `Record` sea
 * total: `status` llega de un `ENUM` de MySQL, y un valor añadido allí antes
 * que aquí imprimiría `undefined` dentro del correo. Con `null`, `render`
 * pone "(no disponible)".
 */
function statusLabel(status: TicketStatus): string | null {
  return TICKET_STATUS_LABELS[status] ?? null;
}

/**
 * Deshace exactamente los cinco escapes que aplica `render` a los valores
 * sustituidos, y ninguno más.
 *
 * Hace falta porque `render` escapa siempre —está pensado para el cuerpo
 * HTML—, pero el asunto de un correo y su parte `text/plain` no son HTML: ahí
 * un apóstrofo del asunto del ticket se leería literalmente como `&#39;`. El
 * `&amp;` va el último a propósito: al revés, `&amp;lt;` acabaría convertido
 * en `<`, que es justo la reinyección que el escapado evita.
 */
function undoHtmlEscaping(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Marcado de línea del cuerpo: la columna se llama `body_md` y las siete
 * plantillas sembradas usan negritas y viñetas. Sin esto el cliente leería
 * `- **Código:** TKT-0013` con los asteriscos a la vista.
 *
 * Es un subconjunto mínimo y deliberado —negrita, viñeta, enlace—, no un
 * intérprete de Markdown: cuanto menos transforme, menos formas hay de que el
 * contenido escrito por el cliente acabe significando algo.
 */
function inlineMarkup(line: string): string {
  return (
    line
      // Los enlaces van solos en su línea en las plantillas sembradas. Se corta
      // en `<` para no tragarse las etiquetas que esta misma función genera.
      .replace(/\bhttps?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  );
}

/**
 * Convierte el texto ya renderizado en HTML sencillo: párrafos separados por
 * línea en blanco, bloques de líneas que empiezan por `- ` como lista, y
 * saltos de línea sueltos como `<br>`.
 *
 * **No escapa nada.** El contenido del cliente ya viene escapado por `render`,
 * y volver a escapar aquí convertiría un `&lt;` en `&amp;lt;`, que es lo que el
 * lector vería en pantalla. Tampoco puede inyectar: lo único que se añade son
 * las etiquetas que pone esta función, y un `<` del cliente ya no es un `<`
 * cuando llega hasta aquí. El resto del texto lo escribe el equipo en el panel
 * y pasa por `validateTemplate` al guardarse.
 */
function textToSimpleHtml(text: string): string {
  const bloques = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((bloque) => {
      const lineas = bloque.split('\n').map((l) => l.trim());
      if (lineas.every((l) => l.startsWith('- '))) {
        const items = lineas.map((l) => `<li>${inlineMarkup(l.slice(2))}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${lineas.map(inlineMarkup).join('<br>')}</p>`;
    });

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#22272a">${bloques.join(
    '',
  )}</div>`;
}

/**
 * Un identificador utilizable, o `null`.
 *
 * TypeORM hidrata **toda** columna `bigint` como cadena aunque la entidad la
 * declare `number` (`Ticket.id`, `clientId`, `assigneeUserId`,
 * `createdByClientUserId`…). Comparar o indexar con `===` estricto contra un
 * número es siempre falso, y aquí eso significaría no encontrar al autor del
 * ticket —o, peor, buscar el usuario equivocado—. Fuera quedan `null`,
 * `undefined`, la cadena vacía (que `Number` volvería 0) y lo que no dé un
 * número finito positivo.
 */
function toId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Fecha legible en español, para lo que lee una persona dentro del correo. */
function formatDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('es-PE', { dateStyle: 'long', timeStyle: 'short' });
}

/** Todo lo que hace falta para poner valores a las variables de un aviso. */
interface NotificationContext {
  ticket: Ticket;
  event: TicketEvent;
  razonSocial: string | null;
  responsable: string | null;
  frontendUrl: string;
}

/**
 * Compone y envía los avisos por correo de un evento de ticket.
 *
 * Tres cosas que no se pueden tocar sin romper la funcionalidad:
 *
 * 1. **Nada de transacciones.** Este servicio no abre ninguna y no debe
 *    llamarse desde dentro de una: un correo enviado dentro de una transacción
 *    que después se deshace es una mentira que ya no se puede retirar.
 * 2. **Un fallo de envío se propaga.** No se captura, no se registra para
 *    seguir: si se tragara aquí, el vigilante sellaría la fila como enviada y
 *    el correo se perdería sin dejar rastro. Quien decide si se reintenta es
 *    él, no esto.
 * 3. **Los valores se construyen por público, en dos funciones separadas**
 *    (`clientValues` / `teamValues`), cada una enumerando lo suyo. No hay un
 *    juego común del que se quiten claves para el cliente: ese atajo hace que
 *    la variable que se añada dentro de seis meses aparezca sola en el correo
 *    del cliente. Es la misma disciplina con la que el portal proyecta campo
 *    por campo.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly clients: ClientsRepository,
    private readonly clientUsers: ClientUsersRepository,
    private readonly users: UsersService,
    private readonly workspace: WorkspaceService,
    private readonly templates: NotificationTemplatesService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Despacha los avisos que correspondan a un evento ya confirmado en base.
   *
   * Devuelve cuántos correos salieron y, si alguno no salió, por qué. Que no
   * salga ninguno es un resultado normal y frecuente: la mayoría de los
   * eventos no avisan a nadie, y desactivar una plantilla es la forma
   * documentada de apagar un aviso sin tocar código.
   */
  async dispatchForEvent(event: TicketEvent): Promise<DispatchResult> {
    const ticketId = toId(event.ticketId);
    const ticket = ticketId === null ? null : await this.tickets.findById(ticketId);
    if (!ticket) {
      return { sent: 0, skipped: `El ticket ${String(event.ticketId)} ya no existe.` };
    }

    const clientAuthorId = toId(ticket.createdByClientUserId);
    const assigneeId = toId(ticket.assigneeUserId);

    const plan = plansForEvent({
      type: event.type,
      toStatus: event.toStatus,
      origin: ticket.origin,
      hasClientAuthor: clientAuthorId !== null,
      hasAssignee: assigneeId !== null,
    });

    if (plan.length === 0) {
      return { sent: 0, skipped: 'El evento no genera ningún aviso.' };
    }

    const context = await this.buildContext(ticket, event, assigneeId);

    let sent = 0;
    const razones: string[] = [];

    for (const entry of plan) {
      const razon = await this.dispatchOne(entry, context, clientAuthorId, assigneeId);
      if (razon === null) sent += 1;
      else razones.push(razon);
    }

    return { sent, skipped: razones.length > 0 ? razones.join(' ') : null };
  }

  /**
   * Un aviso concreto. Devuelve `null` si se envió, o la razón por la que no.
   *
   * Lo que no devuelve nunca es una razón por un fallo de envío: eso sube tal
   * cual (ver la regla 2 de la cabecera de la clase).
   */
  private async dispatchOne(
    entry: NotificationPlanEntry,
    context: NotificationContext,
    clientAuthorId: number | null,
    assigneeId: number | null,
  ): Promise<string | null> {
    const template = await this.templates.findActive(entry.triggerKey, entry.audience);
    if (!template) {
      // No es un error: es exactamente cómo se apaga un aviso desde el panel.
      return `El aviso ${entry.triggerKey}/${entry.audience} no tiene plantilla activa.`;
    }

    const to =
      entry.audience === 'CLIENT'
        ? await this.resolveClientRecipient(clientAuthorId)
        : await this.resolveTeamRecipient(context.event, assigneeId);

    if (!to) {
      return `El aviso ${entry.triggerKey}/${entry.audience} no tiene destinatario.`;
    }

    const values =
      entry.audience === 'CLIENT' ? this.clientValues(context) : this.teamValues(context);

    await this.email.send(this.compose(template, entry.audience, values, to));
    this.logger.log(
      `Aviso ${entry.triggerKey}/${entry.audience} enviado para el ticket ${String(context.ticket.id)}.`,
    );
    return null;
  }

  /**
   * Un correo listo para `EmailService.send`.
   *
   * El asunto y la parte de texto van sin las entidades HTML que introduce
   * `render`: ninguno de los dos es HTML. El `html` sí las conserva.
   */
  private compose(
    template: NotificationTemplate,
    audience: NotificationAudience,
    values: Record<string, string | null>,
    to: string,
  ) {
    const subject = render(template.subject, audience, values);
    const body = render(template.bodyMd, audience, values);

    return {
      to,
      subject: undoHtmlEscaping(subject),
      html: textToSimpleHtml(body),
      text: undoHtmlEscaping(body),
    };
  }

  // -------------------------------------------------------------------------
  // Los valores, uno por público. Dos funciones, cada una enumerando lo suyo.
  // -------------------------------------------------------------------------

  /**
   * Las seis variables del cliente, escritas una a una.
   *
   * El tipo de retorno es `Record<ClientVariable, …>`: si mañana se añade una
   * variable al catálogo del cliente, esto deja de compilar hasta que se
   * enumere aquí. Y —lo importante— añadir una al catálogo del **equipo** no
   * toca esta función en absoluto: por eso no puede colarse sola en el correo
   * del cliente.
   */
  private clientValues(context: NotificationContext): Record<ClientVariable, string | null> {
    const { ticket, event, razonSocial, frontendUrl } = context;
    return {
      codigo: ticket.code,
      asunto: ticket.subject,
      estado: statusLabel(ticket.status),
      fecha: formatDateTime(event.createdAt),
      razon_social: razonSocial,
      enlace_portal: `${frontendUrl}/portal/tickets/${String(ticket.id)}`,
    };
  }

  /**
   * Las once variables del equipo, escritas una a una.
   *
   * Repite las seis del cliente a propósito, en vez de extender el juego de
   * `clientValues`: encadenarlas convertiría los dos juegos en uno solo con
   * añadidos, que es justo la forma de la que una variable nueva termina
   * apareciendo donde no debe.
   */
  private teamValues(context: NotificationContext): Record<TeamVariable, string | null> {
    const { ticket, event, razonSocial, responsable, frontendUrl } = context;
    return {
      codigo: ticket.code,
      asunto: ticket.subject,
      estado: statusLabel(ticket.status),
      fecha: formatDateTime(event.createdAt),
      razon_social: razonSocial,
      enlace_portal: `${frontendUrl}/portal/tickets/${String(ticket.id)}`,
      prioridad: ticket.priority,
      sla: formatDateTime(ticket.slaResolutionDueAt),
      responsable: responsable ?? SIN_RESPONSABLE,
      motivo: event.reason,
      enlace_panel: `${frontendUrl}/tickets/${String(ticket.id)}`,
    };
  }

  // -------------------------------------------------------------------------
  // Destinatarios (spec §3)
  // -------------------------------------------------------------------------

  /**
   * El autor del ticket, y nadie más de su empresa.
   *
   * Un usuario desactivado tampoco recibe nada: `PortalAuthService` ya le
   * niega la entrada al portal, y seguir mandándole por correo el detalle de
   * los tickets sería dejar abierta por otro lado la puerta que se cerró (el
   * caso típico es alguien que dejó la empresa cliente).
   */
  private async resolveClientRecipient(clientAuthorId: number | null): Promise<string | null> {
    if (clientAuthorId === null) return null;
    const author = await this.clientUsers.findById(clientAuthorId);
    if (!author || !author.isActive) return null;
    return author.email?.trim() || null;
  }

  /**
   * El responsable si el aviso es de SLA en riesgo y lo hay; si no, el buzón
   * del equipo; y si está vacío, la dirección del remitente SMTP.
   *
   * La condición se lee del tipo de evento y no de la clave del aviso: es el
   * enum `TicketEventType`, así que un cambio de nombre en las claves
   * sembradas no puede desviar en silencio el correo del responsable al buzón.
   */
  private async resolveTeamRecipient(
    event: TicketEvent,
    assigneeId: number | null,
  ): Promise<string | null> {
    if (event.type === 'SLA_AT_RISK' && assigneeId !== null) {
      const assignee = await this.users.findById(assigneeId);
      const email = assignee?.email?.trim();
      if (email) return email;
    }

    const inbox = await this.workspace.getTeamInboxEmail();
    if (inbox) return inbox;

    return this.senderAddress();
  }

  /**
   * La dirección del remitente, como último recurso del correo interno.
   *
   * Prioriza la configuración de la base (la que usa de verdad
   * `EmailService`), y cae al `.env` con el mismo orden que él, para que el
   * aviso no se mande a un sitio distinto del que dice el `From`.
   */
  private async senderAddress(): Promise<string | null> {
    const smtp = await this.workspace.getSmtpConfig();
    if (smtp?.from) return smtp.from;
    return (
      this.config.get<string>('SMTP_FROM') ?? this.config.get<string>('SMTP_USER') ?? null
    );
  }

  // -------------------------------------------------------------------------

  private async buildContext(
    ticket: Ticket,
    event: TicketEvent,
    assigneeId: number | null,
  ): Promise<NotificationContext> {
    const clientId = toId(ticket.clientId);
    const client = clientId === null ? null : await this.clients.findById(clientId);
    const assignee = assigneeId === null ? null : await this.users.findById(assigneeId);

    return {
      ticket,
      event,
      razonSocial: client?.razonSocial ?? null,
      responsable: assignee?.fullName ?? null,
      // Sin barra final: los enlaces se montan con `/portal/tickets/...`, y
      // una barra de más dejaría `//portal/...` en el correo.
      frontendUrl: (
        this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL
      ).replace(/\/+$/, ''),
    };
  }
}
