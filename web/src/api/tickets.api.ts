import { api } from './client';
import type {
  CreatedTicket,
  Ticket, TicketDetail, TicketStatus, TicketPriority, TicketImpact, TicketUrgency,
  TicketOrigin, TicketRequestType, ServiceCategory, ClientSystem, SupportAgent, SupportAgentView, AgentLevel,
} from './types';

export interface CreateTicketBody {
  rawText: string;
  subject?: string;
  origin?: TicketOrigin;
  requestType?: TicketRequestType;
  serviceCategory?: ServiceCategory;
  impact?: TicketImpact;
  urgency?: TicketUrgency;
  clientId?: number;
  projectId?: number;
  systemId?: number;
  capturedAt?: string;
  scheduledAt?: string;
  durationMinutes?: number;
  acceptanceCriteria?: string[];
  moduleName?: string;
  screenName?: string;
  flowContext?: string;
}

export interface TicketListParams {
  status?: TicketStatus;
  open?: boolean;
  clientId?: number;
  systemId?: number;
  priority?: TicketPriority;
  assigneeId?: number;
  serviceCategory?: ServiceCategory;
  atRisk?: boolean;
  q?: string;
}

export const ticketsApi = {
  list: (params?: TicketListParams) =>
    api.get<Ticket[]>('/tickets', { params }).then((r) => r.data),

  findOne: (id: number) => api.get<TicketDetail>(`/tickets/${id}`).then((r) => r.data),

  /**
   * Devuelve `CreatedTicket` y no `Ticket`: el alta trae además el
   * `firstMessageId` del primer mensaje del hilo, que es contra el que se suben
   * los adjuntos aportados al crear el ticket.
   */
  create: (body: CreateTicketBody) =>
    api.post<CreatedTicket>('/tickets', body).then((r) => r.data),

  update: (id: number, body: Partial<CreateTicketBody> & { descriptionMd?: string }) =>
    api.patch<Ticket>(`/tickets/${id}`, body).then((r) => r.data),

  remove: (id: number) => api.delete<{ ok: true }>(`/tickets/${id}`).then((r) => r.data),

  transition: (
    id: number,
    body: {
      toStatus: TicketStatus;
      reason?: string;
      resolutionMd?: string;
      rootCause?: string;
      correctiveAction?: string;
    },
  ) => api.post<Ticket>(`/tickets/${id}/transition`, body).then((r) => r.data),

  assign: (id: number, body: { assigneeUserId: number; reason?: string }) =>
    api.post<Ticket>(`/tickets/${id}/assign`, body).then((r) => r.data),

  take: (id: number) => api.post<Ticket>(`/tickets/${id}/take`).then((r) => r.data),

  escalate: (id: number, body: { toLevel: AgentLevel; reason: string; assigneeUserId?: number }) =>
    api.post<Ticket>(`/tickets/${id}/escalate`, body).then((r) => r.data),

  overridePriority: (
    id: number,
    body: { impact?: TicketImpact; urgency?: TicketUrgency; priority?: TicketPriority; reason: string },
  ) => api.post<Ticket>(`/tickets/${id}/priority`, body).then((r) => r.data),

  suggestAssignee: (id: number) =>
    api.get<SupportAgent | null>(`/tickets/${id}/suggest-assignee`).then((r) => r.data),

  triage: (id: number) => api.post<Ticket>(`/tickets/${id}/triage`).then((r) => r.data),

  pushToJira: (id: number) => api.post<Ticket>(`/tickets/${id}/push-to-jira`).then((r) => r.data),

  transcribe: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<{ text: string; language: string | null }>('/tickets/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};

export const clientSystemsApi = {
  list: (clientId: number) =>
    api.get<ClientSystem[]>(`/clients/${clientId}/systems`).then((r) => r.data),
  create: (clientId: number, body: { name: string }) =>
    api.post<ClientSystem>(`/clients/${clientId}/systems`, body).then((r) => r.data),
  update: (clientId: number, id: number, body: { name?: string; isActive?: boolean }) =>
    api.patch<ClientSystem>(`/clients/${clientId}/systems/${id}`, body).then((r) => r.data),
  remove: (clientId: number, id: number) =>
    api.delete<{ ok: true }>(`/clients/${clientId}/systems/${id}`).then((r) => r.data),
};

export const supportAgentsApi = {
  list: () => api.get<SupportAgentView[]>('/support-agents').then((r) => r.data),
  create: (body: { userId: number; level: AgentLevel; specialties?: ServiceCategory[] }) =>
    api.post<SupportAgent>('/support-agents', body).then((r) => r.data),
  update: (id: number, body: { level?: AgentLevel; specialties?: ServiceCategory[]; isActive?: boolean }) =>
    api.patch<SupportAgent>(`/support-agents/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete<{ ok: true }>(`/support-agents/${id}`).then((r) => r.data),
};
