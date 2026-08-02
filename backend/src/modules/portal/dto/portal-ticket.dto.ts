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
export interface PortalTicketEventView {
  type: string;
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

/** Los sistemas del cliente, solo lo imprescindible para poblar un selector. */
export interface PortalClientSystemView {
  id: number;
  name: string;
}
