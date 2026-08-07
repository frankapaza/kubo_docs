/**
 * Reglas de negocio: qué fila de `ticket_events` merece un aviso por correo y
 * para qué público. Dominio puro: sin inyección de dependencias, sin base de
 * datos, sin `Date.now()`. Todo entra por parámetro -- mismo estilo que
 * `./template-renderer.ts`.
 *
 * Lista blanca, no lista negra: un `TicketEventType` (o un `toStatus`) que no
 * está explícitamente contemplado abajo no genera ningún aviso. Es el mismo
 * criterio con el que se filtró el timeline del portal de clientes, y por la
 * misma razón: dentro de seis meses alguien añade un tipo de evento nuevo (el
 * décimo punto de escritura del que habla el diseño), y si esta función
 * tuviera que decir "no" caso por caso, el día en que se le olvide decirlo el
 * sistema le manda a un cliente real un correo sobre algo que no debía saber.
 * Con lista blanca, el silencio es el valor por omisión.
 *
 * Los `triggerKey` de abajo son las nueve claves reales sembradas en
 * `notification_templates` -- siete por la migración 015 y las dos del hilo de
 * mensajes por la 018 (ver `seeded-templates.consistency.spec.ts`, que las
 * copia literalmente). No se inventan aquí: si el despachador busca una clave
 * que no está sembrada, no encuentra plantilla y no manda nada -- en silencio.
 */

import type { TicketEventType } from '../../tickets/entities/ticket-event.entity';
import type { TicketOrigin } from '../../tickets/entities/ticket.entity';
import type { TicketStatus } from '../../tickets/domain/ticket-state-machine';
import type { TicketMessageVisibility } from '../../ticket-messages/entities/ticket-message.entity';
import type { NotificationAudience } from './template-renderer';

/**
 * Quién firmó la fila del evento. Es lo que separa una respuesta del equipo de
 * una del cliente, que en `ticket_events` viven en dos columnas de autor
 * excluyentes (`actor_user_id` / `actor_client_user_id`).
 *
 * `null` es un valor legítimo y frecuente: el vigilante de SLA escribe eventos
 * que no firma nadie. Aquí solo importa para los mensajes, y ahí un autor que
 * no se sabe de qué lado está no dispara ningún aviso.
 */
export type NotificationActorKind = 'CLIENT' | 'TEAM';

/**
 * Lo mínimo del evento que hace falta para decidir. No es el `TicketEvent`
 * completo: nada de id, `createdAt` ni `payload`.
 *
 * `hasClientAuthor` no es una optimización, es el criterio 2 del diseño: un
 * ticket sin autor de cliente (lo abrió el equipo por teléfono, por ejemplo)
 * no tiene a quién escribirle un aviso de cliente, aunque el evento sea de
 * los que sí notifican normalmente.
 */
export interface TicketNotificationEvent {
  /** `ticket_events.type` de la fila que disparó la evaluación. */
  type: TicketEventType;
  /** `ticket_events.to_status`; `null` en eventos que no cambian de estado (p. ej. `SLA_AT_RISK`). */
  toStatus: TicketStatus | null;
  /** Origen del ticket (no del evento): decide el aviso de "ticket nuevo por el portal". */
  origin: TicketOrigin;
  /** Si el ticket tiene un `actor_client_user_id` propio que lo abrió. */
  hasClientAuthor: boolean;
  /**
   * Si el ticket tiene responsable asignado. No decide si el aviso de equipo
   * se produce -- el equipo siempre se avisa de un SLA en riesgo, tenga o no
   * responsable--; solo decide, más adelante y fuera de este módulo, a qué
   * dirección concreta llega: al responsable o, en su ausencia, al buzón del
   * equipo (spec §3). Se recibe aquí para que la firma no tenga que cambiar
   * el día en que eso deje de ser cierto.
   */
  hasAssignee: boolean;
  /**
   * Visibilidad del mensaje que escribió un `MESSAGE_POSTED`; `null` en
   * cualquier otro tipo de evento -- y también en un `MESSAGE_POSTED` cuyo
   * `payload` no se pudo leer.
   *
   * Es el campo por el que existe todo este párrafo: **una nota interna y una
   * respuesta pública escriben el mismo `MESSAGE_POSTED`**, así que unas reglas
   * que miraran solo el tipo de evento le mandarían al cliente un correo sobre
   * una nota que el portal se cuida de no enseñarle. Mirar el tipo no basta:
   * hay que mirar esto.
   *
   * Llega por parámetro, no leyendo la base: este módulo es dominio puro. Lo
   * saca de la fila del evento `NotificationDispatcher`, que sí tiene base
   * delante.
   */
  messageVisibility: TicketMessageVisibility | null;
  /**
   * Quién firmó el evento. Decide **a quién** avisa un mensaje público: si lo
   * escribió el cliente avisa al equipo, y si lo escribió el equipo avisa al
   * autor del ticket. Sin esto, los dos avisos del hilo serían indistinguibles
   * y cada mensaje mandaría los dos correos -- incluido el eco al cliente por
   * su propio mensaje.
   */
  actorKind: NotificationActorKind | null;
}

export interface NotificationPlanEntry {
  triggerKey: string;
  audience: NotificationAudience;
}

export type NotificationPlan = NotificationPlanEntry[];

/** Avisos de cliente que dependen solo del tipo de evento, no del estado destino. */
const CLIENT_TRIGGER_BY_TYPE: Partial<Record<TicketEventType, string>> = {
  CREATED: 'TICKET_CREATED',
  RESOLVED: 'TICKET_RESOLVED',
  CLOSED: 'TICKET_CLOSED',
  REOPENED: 'TICKET_REOPENED',
};

/**
 * El único aviso de cliente que depende del estado destino y no del tipo:
 * `ESPERA_CLIENTE` llega como `STATUS_CHANGED` (ver
 * `TicketEventsService.typeForTransition`), igual que `TRIAJE` o `ASIGNADO`.
 * Sin esta comprobación explícita del estado, un `STATUS_CHANGED` cualquiera
 * -- incluidos los que van a `TRIAJE` o `ASIGNADO`, los más tentadores --
 * dispararía el mismo aviso.
 */
const CLIENT_WAITING_TRIGGER = 'TICKET_WAITING_CLIENT';
const CLIENT_WAITING_STATUS: TicketStatus = 'ESPERA_CLIENTE';

const TEAM_CREATED_PORTAL_TRIGGER = 'TICKET_CREATED_PORTAL';
const TEAM_SLA_AT_RISK_TRIGGER = 'SLA_AT_RISK';

/**
 * Los dos avisos del hilo de mensajes (migración 018). El sufijo nombra a
 * **quien escribe**, no a quién se avisa; eso último lo dice el público.
 */
const TEAM_MESSAGE_FROM_CLIENT_TRIGGER = 'TICKET_MESSAGE_FROM_CLIENT';
const CLIENT_MESSAGE_FROM_TEAM_TRIGGER = 'TICKET_MESSAGE_FROM_TEAM';

/** La única visibilidad de mensaje que llega a producir un aviso. */
const PUBLIC_MESSAGE_VISIBILITY: TicketMessageVisibility = 'PUBLICA';

/**
 * Si el evento es un mensaje **público** escrito por el lado indicado.
 *
 * Las tres condiciones se comprueban en positivo, y eso es la regla, no un
 * detalle de estilo. Con `!== 'INTERNA'` en vez de `=== 'PUBLICA'`, un
 * `MESSAGE_POSTED` cuya visibilidad no se pudo leer -- un `payload` incompleto,
 * un valor nuevo en el ENUM -- pasaría por público y le mandaría a un cliente
 * el aviso de una nota interna. Un correo no se retira: lo desconocido calla.
 */
function isPublicMessageFrom(
  event: TicketNotificationEvent,
  actorKind: NotificationActorKind,
): boolean {
  return (
    event.type === 'MESSAGE_POSTED' &&
    event.messageVisibility === PUBLIC_MESSAGE_VISIBILITY &&
    event.actorKind === actorKind
  );
}

function clientTriggerFor(event: TicketNotificationEvent): string | null {
  if (event.type === 'STATUS_CHANGED' && event.toStatus === CLIENT_WAITING_STATUS) {
    return CLIENT_WAITING_TRIGGER;
  }
  // Escribió el equipo: se avisa al autor del ticket. (El `hasClientAuthor` que
  // exige que ese autor exista lo pone `plansForEvent`, para todos los avisos
  // de cliente por igual.)
  if (isPublicMessageFrom(event, 'TEAM')) return CLIENT_MESSAGE_FROM_TEAM_TRIGGER;
  return CLIENT_TRIGGER_BY_TYPE[event.type] ?? null;
}

function teamTriggerFor(event: TicketNotificationEvent): string | null {
  if (event.type === 'CREATED' && event.origin === 'PORTAL') return TEAM_CREATED_PORTAL_TRIGGER;
  if (event.type === 'SLA_AT_RISK') return TEAM_SLA_AT_RISK_TRIGGER;
  /**
   * Escribió el cliente: se avisa al equipo. **Sin mirar el estado del ticket,
   * `RESUELTO` incluido**, y es deliberado: es el caso del cliente que responde
   * «sigue fallando» a un ticket que el equipo dio por terminado. Condicionarlo
   * a los estados "activos" dejaría ese mensaje donde nadie lo lee, que es
   * exactamente el argumento con el que `TicketMessagesService` rechaza los
   * mensajes en tickets cerrados. (Por eso esta función no recibe el estado del
   * ticket: no hay nada que consultar.)
   */
  if (isPublicMessageFrom(event, 'CLIENT')) return TEAM_MESSAGE_FROM_CLIENT_TRIGGER;
  return null;
}

/**
 * Decide qué avisos corresponden a un evento. Un mismo evento puede producir
 * dos avisos -- uno por público --: el alta desde el portal avisa al cliente
 * (si tiene autor) y al equipo a la vez.
 *
 * **Una nota interna no produce ninguno.** No es un caso que se excluya con un
 * `if` al principio, sino la consecuencia de que los dos avisos del hilo exijan
 * `messageVisibility === 'PUBLICA'`: la lista blanca no la contempla, así que
 * calla. Tiene bloque propio en `notification-rules.spec.ts` porque es la regla
 * que no puede depender de que nadie se acuerde.
 */
export function plansForEvent(event: TicketNotificationEvent): NotificationPlan {
  const plan: NotificationPlan = [];

  if (event.hasClientAuthor) {
    const clientTriggerKey = clientTriggerFor(event);
    if (clientTriggerKey) plan.push({ triggerKey: clientTriggerKey, audience: 'CLIENT' });
  }

  const teamTriggerKey = teamTriggerFor(event);
  if (teamTriggerKey) plan.push({ triggerKey: teamTriggerKey, audience: 'TEAM' });

  return plan;
}
