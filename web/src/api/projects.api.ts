import { api } from './client';
import type { Paginated, Project } from './types';

export const projectsApi = {
  list: (params?: { status?: 'ACTIVE' | 'ARCHIVED'; clientId?: number }) =>
    api.get<Paginated<Project>>('/projects', { params }).then((r) => r.data),
  findOne: (id: number) => api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (body: { code: string; jiraCode?: string; name: string; description?: string; clientId?: number }) =>
    api.post<Project>('/projects', body).then((r) => r.data),
  update: (id: number, body: Partial<{ name: string; jiraCode: string | null; description: string; status: 'ACTIVE' | 'ARCHIVED' }>) =>
    api.patch<Project>(`/projects/${id}`, body).then((r) => r.data),
  archive: (id: number) =>
    api.patch<Project>(`/projects/${id}`, { status: 'ARCHIVED' }).then((r) => r.data),
  activate: (id: number) =>
    api.patch<Project>(`/projects/${id}`, { status: 'ACTIVE' }).then((r) => r.data),
  updateJiraConfig: (
    id: number,
    body: { jiraIntegrationId: number | null; jiraProjectKey: string | null },
  ) => api.patch<Project>(`/projects/${id}/jira-config`, body).then((r) => r.data),
};
