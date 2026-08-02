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
 * Los `triggerKey` de abajo son las siete claves reales sembradas por la
 * migración 015 en `notification_templates` (ver
 * `seeded-templates.consistency.spec.ts`, que las copia literalmente). No se
 * inventan aquí: si el despachador de la tarea siguiente busca una clave que
 * no está sembrada, no encuentra plantilla y no manda nada -- en silencio.
 */

import type { TicketEventType } from '../../tickets/entities/ticket-event.entity';
import type { TicketOrigin } from '../../tickets/entities/ticket.entity';
import type { TicketStatus } from '../../tickets/domain/ticket-state-machine';
import type { NotificationAudience } from './template-renderer';

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

function clientTriggerFor(event: TicketNotificationEvent): string | null {
  if (event.type === 'STATUS_CHANGED' && event.toStatus === CLIENT_WAITING_STATUS) {
    return CLIENT_WAITING_TRIGGER;
  }
  return CLIENT_TRIGGER_BY_TYPE[event.type] ?? null;
}

function teamTriggerFor(event: TicketNotificationEvent): string | null {
  if (event.type === 'CREATED' && event.origin === 'PORTAL') return TEAM_CREATED_PORTAL_TRIGGER;
  if (event.type === 'SLA_AT_RISK') return TEAM_SLA_AT_RISK_TRIGGER;
  return null;
}

/**
 * Decide qué avisos corresponden a un evento. Un mismo evento puede producir
 * dos avisos -- uno por público --: el alta desde el portal avisa al cliente
 * (si tiene autor) y al equipo a la vez.
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
