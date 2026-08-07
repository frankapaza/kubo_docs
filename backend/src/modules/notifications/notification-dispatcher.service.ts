import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClientsRepository } from '../clients/clients.repository';
import { EmailService } from '../email/email.service';
import { ClientUsersRepository } from '../portal/client-users.repository';
import {
  TICKET_MESSAGE_VISIBILITIES,
  TicketMessageVisibility,
} from '../ticket-messages/entities/ticket-message.entity';
import { TicketEvent, TicketEventType } from '../tickets/entities/ticket-event.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TICKET_STATUS_LABELS, TicketStatus } from '../tickets/domain/ticket-state-machine';
import { UsersService } from '../users/users.service';
import { TicketsRepository } from '../tickets/tickets.repository';
import { WorkspaceService } from '../workspace/workspace.service';

import { composeEmail } from './domain/email-compose';
import {
  NotificationActorKind,
  NotificationPlanEntry,
  plansForEvent,
} from './domain/notification-rules';
import { ClientVariable, NotificationAudience, TeamVariable } from './domain/template-renderer';
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

/**
 * Fallo al despachar los avisos de un evento. Lleva **qué salió y qué no**,
 * porque el reintento del vigilante es a nivel de evento: sin esa lista, quien
 * mire `notify_last_error` no puede saber si el próximo intento va a duplicar
 * un correo ya entregado.
 */
export class NotificationDispatchError extends Error {
  readonly code = 'NOTIFICATION_SEND_ERROR';

  constructor(
    message: string,
    /** Avisos que sí se entregaron antes del fallo, como `TRIGGER/PUBLICO`. */
    readonly sentEntries: string[],
    /** Avisos que fallaron, en el mismo formato. */
    readonly failedEntries: string[],
    /** Los errores originales del transporte, sin recortar. */
    readonly causes: unknown[],
  ) {
    super(message);
    this.name = 'NotificationDispatchError';
  }
}

/** URL base del frontend cuando no hay `FRONTEND_URL`; misma que usa el envío de firmas. */
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

/**
 * La URL base de los enlaces del correo, ya sin barra final.
 *
 * `|| ''` y no `??`: `docker-compose.yml` inyecta `FRONTEND_URL: ${FRONTEND_URL}`
 * y Compose **sustituye por cadena vacía** cuando la variable no está en el
 * `.env`; no omite la clave. Con `??`, esa cadena vacía pasaría de largo y los
 * avisos saldrían con enlaces relativos (`/portal/tickets/13`), sin host, que
 * es peor que un localhost: un enlace a localhost al menos se entiende y se
 * arregla a mano, uno sin host no lleva a ninguna parte.
 */
function resolveFrontendUrl(config: ConfigService): string {
  const raw = (config.get<string>('FRONTEND_URL') || '').trim();
  return (raw || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');
}

/** El texto de un error, venga de donde venga. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Cómo se ve un dato que falta en el correo del equipo. Nunca la llave cruda. */
const SIN_RESPONSABLE = 'Sin asignar';

/**
 * Los avisos de equipo que van al responsable cuando lo hay, y al buzón cuando
 * no (ver `resolveTeamRecipient`).
 *
 * `SLA_AT_RISK` porque es suyo el plazo que vence. `MESSAGE_POSTED` -- que
 * llega aquí solo cuando es un mensaje público del cliente, porque es lo único
 * que `plansForEvent` deja pasar -- porque quien tiene el hilo en la cabeza es
 * quien lo lleva; el buzón es el respaldo para el ticket que aún no tiene dueño.
 *
 * El alta desde el portal se queda fuera a propósito: un ticket recién entrado
 * hay que triarlo, y eso lo mira el buzón aunque exista un responsable puesto.
 */
const TEAM_EVENTS_TO_ASSIGNEE: ReadonlySet<TicketEventType> = new Set<TicketEventType>([
  'SLA_AT_RISK',
  'MESSAGE_POSTED',
]);

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
 * El estado que cuenta el aviso: el que dejó **el evento**, no el que tenga el
 * ticket cuando el vigilante lo drene.
 *
 * Entre lo uno y lo otro puede pasar hasta un minuto —el aviso viaja por una
 * bandeja de salida—, y dos transiciones dentro del mismo minuto es una
 * secuencia normal: resolver y cerrar a continuación. Leyendo `ticket.status`,
 * el correo de "ya está resuelto" llegaba diciendo "Estado: Cerrado". El dato
 * exacto está en la fila del evento.
 *
 * `toStatus` es nulo en los eventos que no cambian de estado (`SLA_AT_RISK`).
 * Ahí sí se usa el del ticket: es lo único que hay que contar, y además es lo
 * que el técnico necesita saber para atenderlo.
 */
function eventStatusLabel(ticket: Ticket, event: TicketEvent): string | null {
  return statusLabel(event.toStatus ?? ticket.status);
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

/**
 * La visibilidad del mensaje que escribió un `MESSAGE_POSTED`, o `null`.
 *
 * Sale del `payload` de la fila (`{ messageId, visibility }`, lo que escribe
 * `TicketMessagesService.post` en la misma transacción que el mensaje) y no de
 * una segunda consulta a `ticket_messages`: es el dato del hecho registrado, no
 * el estado actual de nada, y así el aviso no depende de que la fila del
 * mensaje siga existiendo cuando el vigilante drene la cola.
 *
 * Se valida contra el enum en vez de devolver la cadena tal cual. Es lo que
 * hace que un `payload` incompleto o con un valor que no reconocemos acabe en
 * `null` --y por tanto en silencio, ver `plansForEvent`-- en vez de colarse
 * como si fuera una visibilidad legítima.
 */
function messageVisibilityOf(event: TicketEvent): TicketMessageVisibility | null {
  if (event.type !== 'MESSAGE_POSTED') return null;
  const raw = (event.payload as { visibility?: unknown } | null)?.visibility;
  return TICKET_MESSAGE_VISIBILITIES.find((v) => v === raw) ?? null;
}

/**
 * Si una columna de autor **trae algo**, sea o no utilizable.
 *
 * Es la distinción que sostiene `actorKindOf`: "columna vacía" y "columna
 * ilegible" son cosas distintas. `null` y `undefined` son la ausencia -- la
 * columna es `NULL` en base, que es el caso normal, porque las dos de autor son
 * excluyentes--. Cualquier otra cosa, incluida la cadena vacía y el cero, es
 * una fila que dice haber tenido un autor y cuyo id no podemos leer.
 */
function hasActorColumn(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * De qué lado es quien firmó el evento, leído de las dos columnas de autor.
 *
 * Se mira **columna a columna, no id a id**, y ahí está todo el asunto. La
 * versión ingenua --"si el id de cliente no se puede leer, entonces escribió el
 * equipo"-- confunde una columna vacía con una ilegible: un
 * `actor_client_user_id` con `'abc'`, `'0'` o la cadena vacía, junto a un
 * `actor_user_id` válido, clasificaba como del equipo un mensaje **que escribió
 * un cliente**, y ese aviso sale hacia fuera, a la bandeja del autor del
 * ticket. Falla abierto y en la dirección peligrosa.
 *
 * Aquí, una columna que trae algo pero no un id utilizable devuelve `null`: la
 * fila no se entiende, así que no se avisa a nadie. Un correo no se retira; el
 * silencio sí se puede investigar después con la fila delante.
 *
 * Cuando las dos son legibles gana el cliente. No es indiferencia: de los dos
 * avisos del hilo, el del cliente escribiendo va al equipo --correo interno-- y
 * el otro sale de casa. Ante una fila ambigua, la salida menos mala es la que
 * se queda dentro.
 */
function actorKindOf(event: TicketEvent): NotificationActorKind | null {
  if (hasActorColumn(event.actorClientUserId)) {
    return toId(event.actorClientUserId) !== null ? 'CLIENT' : null;
  }
  if (hasActorColumn(event.actorUserId)) {
    return toId(event.actorUserId) !== null ? 'TEAM' : null;
  }
  return null;
}

/**
 * La zona en la que se imprimen las fechas de los correos.
 *
 * Escrita aquí y no heredada del proceso. El sistema es UTC de punta a punta y
 * el `Date` que llega es correcto; lo que fallaba era la impresión:
 * `toLocaleString` sin `timeZone` usa la del proceso, y el contenedor de
 * producción corre en UTC —ni el Dockerfile, ni el compose, ni el
 * `.env.production.example` fijan `TZ`—. Un ticket abierto a las 18:14 de Lima
 * le llegaba al cliente como las 11:14 p. m.
 *
 * Se fija aquí, en el formateo, y no con un `TZ` en el contenedor: así es
 * determinista y no depende de que alguien acierte con una variable de entorno
 * que hoy no pone nadie. Y no se cazó antes porque el backend de desarrollo
 * corre en el host, que ya está en hora de Lima.
 */
const PERU_TIME_ZONE = 'America/Lima';

/**
 * Cómo se marca la zona dentro del correo.
 *
 * Una hora suelta en un correo transaccional es ambigua justo cuando más
 * importa —el plazo de un SLA, la hora en que se cerró un ticket—, y el lector
 * no tiene forma de saber en qué zona la escribió el servidor. Va como texto y
 * no con `timeZoneName`: esa opción no se puede combinar con `dateStyle` /
 * `timeStyle`, y "hora de Perú" se lee mejor que "GMT-5".
 */
const PERU_TIME_ZONE_LABEL = 'hora de Perú';

/** Fecha legible en español, en hora de Perú, para lo que lee una persona. */
function formatDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const texto = date.toLocaleString('es-PE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: PERU_TIME_ZONE,
  });
  return `${texto} (${PERU_TIME_ZONE_LABEL})`;
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
 * 2. **Un fallo de envío se propaga.** No se traga, no se registra para
 *    seguir: si se tragara aquí, el vigilante sellaría la fila como enviada y
 *    el correo se perdería sin dejar rastro. Quien decide si se reintenta es
 *    él, no esto. Lo único que se hace antes de relanzar es **intentar el
 *    resto del plan** (ver abajo).
 * 3. **Los valores se construyen por público, en dos funciones separadas**
 *    (`clientValues` / `teamValues`), cada una enumerando lo suyo. No hay un
 *    juego común del que se quiten claves para el cliente: ese atajo hace que
 *    la variable que se añada dentro de seis meses aparezca sola en el correo
 *    del cliente. Es la misma disciplina con la que el portal proyecta campo
 *    por campo.
 *
 * ## El cuerpo de un mensaje del hilo no viaja en el correo
 *
 * El aviso de `MESSAGE_POSTED` dice **que hay un mensaje nuevo** y manda al
 * portal o al panel; no reproduce el texto. Por eso este servicio no consulta
 * `ticket_messages` ni saca del `payload` nada más que la visibilidad, y por
 * eso no hay ninguna variable de mensaje en el catálogo del renderizador: la
 * decisión se sostiene sola, sin depender de que nadie recuerde no usarla.
 *
 * El motivo, en una línea: un correo no se puede retirar y el cuerpo lo escribe
 * una persona que puede equivocarse de destinatario. Un mensaje mal dirigido se
 * borra del hilo; el correo que ya salió, no. El razonamiento completo está en
 * `domain/seeded-templates.consistency.spec.ts`, junto al test que lo ata.
 *
 * ## El envío parcial, y por qué se acepta que duplique
 *
 * Un evento puede producir dos avisos: el alta desde el portal escribe al
 * autor y al buzón del equipo. Si el primero sale y el segundo falla, el
 * vigilante reintentará **el evento entero** y el primero llegará dos veces.
 *
 * Se decidió no persistir el progreso parcial: haría falta otra columna y otra
 * migración para un caso poco frecuente. El fallo típico de SMTP es total —el
 * servidor no responde y fallan los dos, sin duplicado—; el parcial solo
 * aparece cuando rebota una dirección concreta, y ahí reintentar el evento
 * entero al menos garantiza que el otro destinatario acabe recibiendo el suyo.
 * Un correo repetido es peor que ninguno, pero mucho menos malo que un aviso
 * que nunca llega.
 *
 * De ahí las dos consecuencias visibles en el código, que son deliberadas y no
 * hay que "arreglar":
 *
 * - Se intentan **todas** las entradas del plan aunque una falle. Abortar en la
 *   primera dejaba al equipo sin enterarse de un ticket nuevo solo porque la
 *   dirección del cliente rebotó.
 * - El error que sube es un `NotificationDispatchError` que dice cuántos
 *   salieron y cuáles, para que el rastro que guarde la Task 6 permita saber
 *   si el reintento va a duplicar algo.
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

    // Los dos que distinguen una nota interna de una respuesta pública, y a la
    // respuesta del equipo de la del cliente. Van por parámetro porque
    // `plansForEvent` es dominio puro; quien tiene la fila delante es esto.
    const messageVisibility = messageVisibilityOf(event);
    const actorKind = actorKindOf(event);
    this.warnUnreadableMessageRow(event, messageVisibility, actorKind);

    const plan = plansForEvent({
      type: event.type,
      toStatus: event.toStatus,
      origin: ticket.origin,
      hasClientAuthor: clientAuthorId !== null,
      hasAssignee: assigneeId !== null,
      messageVisibility,
      actorKind,
    });

    if (plan.length === 0) {
      return { sent: 0, skipped: 'El evento no genera ningún aviso.' };
    }

    const context = await this.buildContext(ticket, event, assigneeId);

    const razones: string[] = [];
    const enviados: string[] = [];
    const fallidos: string[] = [];
    const causas: unknown[] = [];

    for (const entry of plan) {
      const etiqueta = `${entry.triggerKey}/${entry.audience}`;
      try {
        const razon = await this.dispatchOne(entry, context, clientAuthorId, assigneeId);
        if (razon === null) enviados.push(etiqueta);
        else razones.push(razon);
      } catch (error) {
        // Este `catch` **no traga nada**: lo único que hace es dejar que el
        // resto del plan se intente. Todo lo recogido aquí vuelve a lanzarse
        // unas líneas más abajo, antes de devolver.
        fallidos.push(etiqueta);
        causas.push(error);
      }
    }

    if (fallidos.length > 0) {
      throw this.buildDispatchError(context, plan.length, enviados, fallidos, causas);
    }

    return { sent: enviados.length, skipped: razones.length > 0 ? razones.join(' ') : null };
  }

  /**
   * Deja rastro de una fila de mensaje que no se pudo interpretar.
   *
   * Callarse ante un dato corrupto es lo correcto --ver `actorKindOf`--, pero
   * un silencio sin rastro es indistinguible de una nota interna, que es el
   * caso normal y mayoritario. Sin esto, una fila mal migrada dejaría de avisar
   * para siempre y nadie se enteraría nunca. El aviso no sale igual; lo único
   * que cambia es que se puede investigar con la fila delante.
   */
  private warnUnreadableMessageRow(
    event: TicketEvent,
    messageVisibility: TicketMessageVisibility | null,
    actorKind: NotificationActorKind | null,
  ): void {
    if (event.type !== 'MESSAGE_POSTED') return;

    const referencia = `evento ${String(event.id)} (ticket ${String(event.ticketId)})`;

    if (messageVisibility === null) {
      this.logger.warn(
        `El ${referencia} es un mensaje cuya visibilidad no se pudo leer del payload ` +
          `(${JSON.stringify(event.payload?.visibility ?? null)}): no se avisa a nadie. ` +
          'Se trata como no publicable a propósito: lo desconocido no puede salir por correo.',
      );
    }

    const teniaAutor =
      hasActorColumn(event.actorClientUserId) || hasActorColumn(event.actorUserId);

    if (actorKind === null && teniaAutor) {
      this.logger.warn(
        `El ${referencia} es un mensaje con una columna de autor ilegible ` +
          `(actor_client_user_id=${String(event.actorClientUserId)}, ` +
          `actor_user_id=${String(event.actorUserId)}): no se avisa a nadie. ` +
          'No se degrada al otro autor: eso mandaría hacia fuera el mensaje de un cliente.',
      );
    }
  }

  /**
   * Compone el error que sube al vigilante y deja el aviso en el log.
   *
   * El `warn` es explícito con la duplicación a propósito: cuando algo ya salió
   * y algo falló, el reintento del evento entero repetirá lo que ya llegó, y
   * eso tiene que poder leerse en el log del día en que un cliente pregunte
   * por qué recibió dos veces el mismo correo.
   */
  private buildDispatchError(
    context: NotificationContext,
    total: number,
    enviados: string[],
    fallidos: string[],
    causas: unknown[],
  ): NotificationDispatchError {
    const referencia = `evento ${String(context.event.id)} (ticket ${String(context.ticket.id)})`;
    const detalle = fallidos
      .map((etiqueta, i) => `${etiqueta}: ${errorText(causas[i])}`)
      .join('; ');

    if (enviados.length > 0) {
      this.logger.warn(
        `Envío parcial del ${referencia}: salieron ${enviados.length} de ${total} ` +
          `(${enviados.join(', ')}) y falló ${fallidos.length} (${fallidos.join(', ')}). ` +
          'El vigilante reintenta el evento entero, así que los que ya salieron ' +
          'llegarán por segunda vez: es el compromiso aceptado a cambio de que el ' +
          'destinatario que falló acabe recibiendo el suyo.',
      );
    } else {
      this.logger.warn(
        `Ningún aviso del ${referencia} pudo enviarse (${fallidos.join(', ')}): ${detalle}.`,
      );
    }

    const yaEnviados =
      enviados.length > 0
        ? ` Ya habían salido ${enviados.length} de ${total} (${enviados.join(', ')}); ` +
          'el reintento del evento los repetirá.'
        : '';

    return new NotificationDispatchError(
      `No se pudieron enviar ${fallidos.length} de ${total} avisos del ${referencia}. ` +
        `Fallaron: ${detalle}.${yaEnviados}`,
      enviados,
      fallidos,
      causas,
    );
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
        ? await this.resolveClientRecipient(context.ticket, clientAuthorId)
        : await this.resolveTeamRecipient(context.event, assigneeId);

    if (!to) {
      return `El aviso ${entry.triggerKey}/${entry.audience} no tiene destinatario.`;
    }

    const values =
      entry.audience === 'CLIENT' ? this.clientValues(context) : this.teamValues(context);

    const resultado = await this.email.send(this.compose(template, entry.audience, values, to));

    // `EmailService.send` no lanza cuando el servidor acepta el mensaje pero
    // rechaza a un destinatario: eso viaja en `rejected`. Hoy siempre hay uno
    // solo y nodemailer acaba lanzando, pero si no lo miráramos, el día que un
    // aviso vaya a varias direcciones un rebote parcial se sellaría como éxito
    // y el correo se perdería sin que nadie se entere. Lo tratamos como fallo
    // para que el vigilante lo reintente y quede el rastro.
    if (resultado.rejected?.length) {
      throw new Error(
        `El servidor de correo rechazó a ${resultado.rejected.join(', ')} ` +
          `para el aviso ${entry.triggerKey}/${entry.audience}.`,
      );
    }

    this.logger.log(
      `Aviso ${entry.triggerKey}/${entry.audience} enviado para el ticket ${String(context.ticket.id)}.`,
    );
    return null;
  }

  /**
   * Un correo listo para `EmailService.send`.
   *
   * La composición en sí (`subject`/`html`/`text`) vive en `composeEmail`
   * (`./domain/email-compose.ts`), pura y sin depender de este servicio: es
   * el mismo camino que usa `NotificationTemplatesService.preview` /
   * `.sendTest` para que lo que ve el ADMIN al previsualizar sea, letra por
   * letra, lo que este método manda de verdad. Aquí solo se añade el `to`
   * que ya resolvió `dispatchOne`.
   */
  private compose(
    template: NotificationTemplate,
    audience: NotificationAudience,
    values: Record<string, string | null>,
    to: string,
  ) {
    return { to, ...composeEmail(template, audience, values) };
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
      estado: eventStatusLabel(ticket, event),
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
      estado: eventStatusLabel(ticket, event),
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
   * Tres condiciones, y las tres fallan cerrado:
   *
   * - El ticket tiene autor de cliente. Si lo abrió el equipo por teléfono, no
   *   sale nada hacia fuera: no hay a quién.
   * - El autor sigue activo. `PortalAuthService` ya le niega la entrada al
   *   portal cuando no lo está, y seguir mandándole por correo el detalle de
   *   los tickets sería dejar abierta por otro lado la puerta que se cerró (el
   *   caso típico es alguien que dejó la empresa cliente).
   * - **El autor pertenece a la empresa del ticket.** Hoy no hay ningún camino
   *   que lo incumpla —el id sale del propio ticket—, pero esta es la última
   *   comprobación antes de poner una dirección en un `To:`, y es donde un
   *   error de más arriba se convertiría en el ticket de una empresa enviado a
   *   otra. Cuesta una línea y no depende de que nadie se acuerde.
   */
  private async resolveClientRecipient(
    ticket: Ticket,
    clientAuthorId: number | null,
  ): Promise<string | null> {
    if (clientAuthorId === null) return null;

    const author = await this.clientUsers.findById(clientAuthorId);
    if (!author || !author.isActive) return null;

    // Ambos ids han de existir y coincidir: un `null` a cada lado no es una
    // coincidencia, es la ausencia de la comprobación.
    const authorClientId = toId(author.clientId);
    const ticketClientId = toId(ticket.clientId);
    if (authorClientId === null || ticketClientId === null || authorClientId !== ticketClientId) {
      this.logger.error(
        `El autor ${String(author.id)} del ticket ${String(ticket.id)} pertenece al cliente ` +
          `${String(author.clientId)}, pero el ticket es del cliente ${String(ticket.clientId)}: ` +
          'no se envía el aviso.',
      );
      return null;
    }

    return author.email?.trim() || null;
  }

  /**
   * El responsable si el aviso es de los suyos y lo hay; si no, el buzón del
   * equipo; y si está vacío, la dirección del remitente SMTP.
   *
   * La condición se lee del tipo de evento y no de la clave del aviso: es el
   * enum `TicketEventType`, así que un cambio de nombre en las claves
   * sembradas no puede desviar en silencio el correo del responsable al buzón.
   *
   * Un técnico dado de baja no recibe nada, igual que un usuario de cliente
   * desactivado: es correo interno, pero es la misma puerta. Su aviso cae al
   * buzón del equipo, que es justo lo que hay que hacer con un SLA en riesgo
   * cuyo responsable ya no está -- o con un cliente que acaba de escribir.
   */
  private async resolveTeamRecipient(
    event: TicketEvent,
    assigneeId: number | null,
  ): Promise<string | null> {
    if (TEAM_EVENTS_TO_ASSIGNEE.has(event.type) && assigneeId !== null) {
      const assignee = await this.users.findById(assigneeId);
      const email = assignee?.isActive ? assignee.email?.trim() : null;
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
   *
   * `||` y no `??`, por lo mismo que `resolveFrontendUrl` unas líneas más
   * arriba: el compose de producción declara `SMTP_FROM: ${SMTP_FROM}` y
   * Compose sustituye por cadena vacía cuando no está en el `.env`. Con `??`,
   * ese vacío ganaría a `SMTP_USER` y el aviso interno se quedaría sin
   * destinatario — descartado en silencio como "no tiene destinatario".
   */
  private async senderAddress(): Promise<string | null> {
    const smtp = await this.workspace.getSmtpConfig();
    if (smtp?.from) return smtp.from;
    return (
      (this.config.get<string>('SMTP_FROM') || '').trim() ||
      (this.config.get<string>('SMTP_USER') || '').trim() ||
      null
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

    // No tumbar el aviso porque falte el cliente es lo correcto —el correo sale
    // con "(no disponible)" donde iría la razón social—, pero enterarse de que
    // ha pasado también: significa un `client_id` colgando de una fila borrada.
    if (!client) {
      this.logger.warn(
        `El ticket ${String(ticket.id)} no resuelve su cliente ` +
          `(client_id=${String(ticket.clientId)}): el aviso saldrá sin razón social.`,
      );
    }

    return {
      ticket,
      event,
      // `|| null` y no `?? null` en los dos: una cadena vacía guardada en base
      // pasaría de largo con `??`, y entonces `render` no aplicaría su texto de
      // respaldo — la plantilla sacaría "**Empresa:**" y nada detrás.
      razonSocial: client?.razonSocial || null,
      responsable: assignee?.fullName || null,
      frontendUrl: resolveFrontendUrl(this.config),
    };
  }
}
