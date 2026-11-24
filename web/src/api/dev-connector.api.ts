import { api } from './client';

/** Conector de tickets para Claude: repos registrados, claves `kdev_` y código vinculado. */

export interface DevRepoView {
  id: number;
  clientSystemId: number;
  githubFullName: string;
  githubUrl: string;
  isActive: boolean;
  createdAt: string;
}

/** El secreto del webhook solo viaja en esta respuesta: no se vuelve a poder leer. */
export interface IssuedRepoSecret {
  repo: DevRepoView;
  secret: string;
}

export interface DevKeyView {
  id: number;
  devRepoId: number;
  repoFullName: string;
  clientName: string;
  systemName: string;
  keyPrefix: string;
  status: 'ACTIVA' | 'REVOCADA';
  lastUsedAt: string | null;
  createdAt: string;
}

/** La clave en claro (`secret`) solo viaja en esta respuesta. */
export interface IssuedDevKey {
  key: DevKeyView;
  secret: string;
}

export type DevLinkKind = 'BRANCH' | 'COMMIT' | 'PR';

export interface DevLinkView {
  id: number;
  kind: DevLinkKind;
  ref: string;
  title: string | null;
  url: string | null;
  authorLogin: string | null;
  state: string | null;
  source: 'WEBHOOK' | 'MCP';
  occurredAt: string;
}

export const devConnectorApi = {
  listRepos: (clientSystemId?: number) =>
    api.get<DevRepoView[]>('/dev-repos', { params: clientSystemId ? { clientSystemId } : {} }).then((r) => r.data),
  registerRepo: (clientSystemId: number, githubFullName: string) =>
    api.post<IssuedRepoSecret>('/dev-repos', { clientSystemId, githubFullName }).then((r) => r.data),
  setRepoActive: (id: number, isActive: boolean) =>
    api.patch<DevRepoView>(`/dev-repos/${id}`, { isActive }).then((r) => r.data),
  regenerateWebhookSecret: (id: number) =>
    api.post<IssuedRepoSecret>(`/dev-repos/${id}/webhook-secret`).then((r) => r.data),

  myKeys: () => api.get<DevKeyView[]>('/dev-keys').then((r) => r.data),
  issueKey: (devRepoId: number) => api.post<IssuedDevKey>('/dev-keys', { devRepoId }).then((r) => r.data),
  revokeKey: (id: number) => api.delete(`/dev-keys/${id}`).then(() => undefined),

  links: (target: { ticketId: number } | { workItemId: number }) =>
    api.get<DevLinkView[]>('/dev-links', { params: target }).then((r) => r.data),
};

/** Base de la API como URL absoluta (la de producción o la del entorno de desarrollo). */
function apiBase(): URL {
  return new URL(String(api.defaults.baseURL ?? '/api/v1'), window.location.origin);
}

/** Lo que se pega en GitHub como «Payload URL». */
export function webhookUrl(): string {
  const base = apiBase();
  return `${base.origin}${base.pathname.replace(/\/+$/, '')}/dev/github/webhook`;
}

/** `DEVDOCS_URL` del MCP: el origen del sitio (el MCP añade `/api/v1`). */
export function devdocsUrl(): string {
  return apiBase().origin;
}

/** Ruta del MCP instalado en la laptop (guía de integración, paso 4). */
export const MCP_PATH = 'C:/kubo/kubo-devdocs-mcp/dist/index.js';

export function claudeMcpCommand(secret: string): string {
  return (
    `claude mcp add kubo-devdocs --scope local ` +
    `-e DEVDOCS_URL=${devdocsUrl()} -e DEVDOCS_DEV_KEY=${secret} ` +
    `-- node ${MCP_PATH}`
  );
}
