import { TicketEventType } from '../../tickets/entities/ticket-event.entity';

/**
 * Lo que el portal de clientes puede ver de un ticket. Es una lista blanca
 * escrita a mano, no un recorte de la entidad: al añadir una columna nueva a
 * `Ticket` (una nota interna, un coste, un dato de otro cliente) esta
 * proyección no la publica salvo que alguien la escriba aquí a propósito.
 *
 * Fuera, por decisión de producto y de seguridad: prioridad, impacto,
 * urgencia, política y vencimientos de SLA, `slaAtRisk`, `assigneeUserId`,
 * nivel de escalado, texto crudo, resolución, causa raíz y todo lo de Jira.
 */
/**
 * Los tipos de evento que el portal publica, como unión cerrada.
 *
 * No es cosmética: la lista blanca `CLIENT_VISIBLE_EVENT_TYPES` del servicio
 * es lo que mantiene `SLA_AT_RISK` y `PRIORITY_OVERRIDDEN` fuera del timeline
 * del cliente, y con `type: string` el compilador no vigilaba nada. Tipado
 * así, publicar un evento que no esté en la lista no compila: el compilador
 * pasa a ser el segundo guardián de una lista blanca que cumple una función
 * de seguridad.
 *
 * Con `Extract` sobre el enum real, y no con literales sueltos: la unión
 * queda atada a `TicketEventType`, así que no puede prometer un tipo de
 * evento que ya no exista. El frontend la modela igual en
 * `web/src/api/types.ts` (`PortalTicketEventType`).
 */
export type PortalVisibleEventType = Extract<
  TicketEventType,
  | 'CREATED'
  | 'TRIAGED'
  | 'STATUS_CHANGED'
  | 'TAKEN'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'REOPENED'
  | 'CLOSED'
>;

export interface PortalTicketEventView {
  type: PortalVisibleEventType;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
}

export interface PortalTicketView {
  id: number;
  code: string | null;
  subject: string | null;
  descriptionMd: string | null;
  status: string;
  systemId: number | null;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  timeline?: PortalTicketEventView[];
}

/**
 * Lo que devuelve el **alta**: el ticket recién creado más el identificador de
 * su primer mensaje.
 *
 * Es un tipo aparte y no un campo opcional de `PortalTicketView` a propósito.
 * Los adjuntos del alta se suben después contra ese mensaje
 * (`POST /portal/tickets/:id/messages/:messageId/attachments`), así que el dato
 * hace falta **una sola vez**, justo después de crear; publicarlo también en el
 * listado y en el detalle sería un identificador interno viajando en respuestas
 * que no lo necesitan, y la proyección del portal es una lista blanca escrita a
 * mano precisamente para que nada salga "de paso".
 *
 * No es opcional: el alta escribe siempre su primer mensaje, así que quien
 * reciba esto siempre tiene dónde colgar los archivos.
 */
export interface PortalCreatedTicketView extends PortalTicketView {
  firstMessageId: number;
}

/** Los sistemas del cliente, solo lo imprescindible para poblar un selector. */
export interface PortalClientSystemView {
  id: number;
  name: string;
}
