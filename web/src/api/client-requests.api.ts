import { api } from './client';
import type {
  ClientRequest,
  ClientRequestPriority,
  ClientRequestSource,
  ClientRequestStatus,
  ClientRequestType,
} from './types';

export interface CreateClientRequestBody {
  rawText: string;
  source?: ClientRequestSource;
  clientId?: number;
  projectId?: number;
  meetingId?: number;
  rawAudioFilename?: string;
}

export interface UpdateClientRequestBody {
  rawText?: string;
  status?: ClientRequestStatus;
  requestType?: ClientRequestType | null;
  priority?: ClientRequestPriority | null;
  clientId?: number | null;
  projectId?: number | null;
  assigneeUserId?: number | null;
  moduleName?: string | null;
  screenName?: string | null;
  flowContext?: string | null;
  title?: string | null;
  descriptionMd?: string | null;
  acceptanceCriteria?: string[] | null;
  labels?: string[] | null;
}

export const clientRequestsApi = {
  list: (params?: {
    status?: ClientRequestStatus;
    clientId?: number;
    projectId?: number;
    q?: string;
  }) => api.get<ClientRequest[]>('/client-requests', { params }).then((r) => r.data),

  findOne: (id: number) =>
    api.get<ClientRequest>(`/client-requests/${id}`).then((r) => r.data),

  create: (body: CreateClientRequestBody) =>
    api.post<ClientRequest>('/client-requests', body).then((r) => r.data),

  update: (id: number, body: UpdateClientRequestBody) =>
    api.patch<ClientRequest>(`/client-requests/${id}`, body).then((r) => r.data),

  remove: (id: number) =>
    api.delete<{ ok: true }>(`/client-requests/${id}`).then((r) => r.data),

  structure: (id: number) =>
    api.post<ClientRequest>(`/client-requests/${id}/structure`).then((r) => r.data),

  pushToJira: (id: number) =>
    api.post<ClientRequest>(`/client-requests/${id}/push-to-jira`).then((r) => r.data),

  complete: (id: number) =>
    api
      .post<{ request: ClientRequest; documentId: number | null }>(`/client-requests/${id}/complete`)
      .then((r) => r.data),

  transcribe: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<{ text: string; language: string | null }>('/client-requests/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};
