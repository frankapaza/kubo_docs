import { api } from './client';
import type { BacklogResult } from './types';

export type IntegrationProvider = 'JIRA';

export interface Integration {
  id: number;
  provider: IntegrationProvider;
  label: string;
  workspaceUrl: string;
  email: string;
  isActive: number;
  createdAt: string;
}

export interface CreateIntegrationBody {
  provider: IntegrationProvider;
  label: string;
  workspaceUrl: string;
  email: string;
  apiToken: string;
}

export interface JiraProject {
  key: string;
  name: string;
}

export interface JiraExportResult {
  projectKey: string;
  epicsCreated: number;
  storiesCreated: number;
  tasksCreated: number;
  issues: Array<{ key: string; title: string; type: string; url: string }>;
}

export const integrationsApi = {
  list: (): Promise<Integration[]> =>
    api.get('/integrations').then((r) => r.data),

  create: (body: CreateIntegrationBody): Promise<Integration> =>
    api.post('/integrations', body).then((r) => r.data),

  remove: (id: number): Promise<{ ok: true }> =>
    api.delete(`/integrations/${id}`).then((r) => r.data),

  test: (id: number): Promise<{ ok: true; displayName: string }> =>
    api.post(`/integrations/${id}/test`).then((r) => r.data),

  listProjects: (id: number): Promise<JiraProject[]> =>
    api.get(`/integrations/${id}/projects`).then((r) => r.data),

  exportToJira: (
    actaId: number,
    integrationId: number,
    projectKey: string,
    backlog: BacklogResult,
  ): Promise<JiraExportResult> =>
    api
      .post(`/actas/${actaId}/backlog/export/jira`, { integrationId, projectKey, backlog })
      .then((r) => r.data),
};
