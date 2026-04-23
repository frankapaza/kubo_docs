import { api } from './client';
import type { Client, ClientStatus } from './types';

export interface CreateClientBody {
  razonSocial: string;
  ruc?: string;
  jiraCode?: string;
  legalRepName?: string;
  legalRepDoc?: string;
  address?: string;
  phone?: string;
  contactEmail?: string;
  status?: ClientStatus;
  notes?: string;
}

export const clientsApi = {
  list: (params?: { status?: ClientStatus; q?: string }) =>
    api.get<Client[]>('/clients', { params }).then((r) => r.data),

  findOne: (id: number) => api.get<Client>(`/clients/${id}`).then((r) => r.data),

  create: (body: CreateClientBody) =>
    api.post<Client>('/clients', body).then((r) => r.data),

  update: (id: number, body: Partial<CreateClientBody>) =>
    api.patch<Client>(`/clients/${id}`, body).then((r) => r.data),

  remove: (id: number) =>
    api.delete<{ ok: true }>(`/clients/${id}`).then((r) => r.data),
};
