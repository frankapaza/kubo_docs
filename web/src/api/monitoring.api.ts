import { api } from './client';
import { saveAttachmentToDisk } from './ticket-messages.api';
import type { TicketStatus } from './types';

/**
 * Contrato del módulo de monitoreo, copiado de las formas que devuelve el
 * backend (backend/src/modules/monitoring). Los ids llegan como número; las
 * fechas, como ISO 8601.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export const LOG_LEVELS: readonly LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

export type ErrorGroupStatus = 'NUEVO' | 'CON_TICKET' | 'RESUELTO';

// ----------------------------------------------------------------- errores

export interface ErrorGroupView {
  id: number;
  title: string;
  exceptionType: string | null;
  aplicativo: string;
  logger: string;
  installationId: number;
  clientId: number | null;
  clientName: string | null;
  systemId: number | null;
  systemName: string | null;
  status: ErrorGroupStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrencesTotal: number;
  servers: string[];
  reopenedAt: string | null;
  reopenReason: string | null;
  ticket: { id: number; code: string; status: TicketStatus } | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
}

export interface ErrorOccurrenceView {
  id: number;
  occurredAt: string;
  servidor: string;
  hilo: string | null;
  logger: string;
  message: string;
  exception: string | null;
  properties: Record<string, string> | null;
}

export type ErrorGroupDetailView = ErrorGroupView & {
  occurrences: ErrorOccurrenceView[];
  daily: Array<{ day: string; count: number }>;
};

export interface ErrorListParams {
  /** Id de cliente o `interno`. */
  cliente?: string;
  sistemaId?: number;
  aplicativo?: string;
  servidor?: string;
  status?: ErrorGroupStatus;
  /** `YYYY-MM-DD` (día de Perú) o ISO 8601 con zona. */
  desde?: string;
  hasta?: string;
  q?: string;
  orden?: 'ultima' | 'cantidad';
  ticketId?: number;
  page?: number;
  /** Máximo 100. */
  pageSize?: number;
}

export interface ErrorListResult {
  items: ErrorGroupView[];
  total: number;
}

/** Cliente y asignación elegidos cuando el error no trae los suyos. */
export interface CreateTicketFromErrorBody {
  clientId?: number;
  /** `client_systems.id` (la asignación). */
  systemId?: number;
}

export interface CreateTicketFromErrorResult {
  group: ErrorGroupView;
  ticket: { id: number; code: string };
}

/**
 * Código de error (500) cuando el ticket se creó pero no se pudo enlazar al
 * grupo: el mensaje nombra el ticket para enlazarlo a mano.
 */
export const TICKET_LINK_FAILED = 'TICKET_LINK_FAILED';

// -------------------------------------------------------------------- logs

export interface LogLineView {
  id: string;
  ts: string;
  nivel: LogLevel;
  instalacionId: number;
  clienteId: number | null;
  sistemaId: number | null;
  aplicativo: string;
  servidor: string;
  logger: string;
  mensaje: string;
  excepcion: string | null;
  hilo: string | null;
  propiedades: Record<string, string>;
}

export interface LogSearchParams {
  instalacionId?: number;
  /** Id de cliente o `interno`. */
  cliente?: string;
  sistemaId?: number;
  aplicativo?: string;
  servidor?: string;
  /** Nivel mínimo: ese nivel y los más graves. */
  nivel?: LogLevel;
  q?: string;
  desde?: string;
  hasta?: string;
  /** ns (cadena de dígitos) de la página anterior. */
  cursor?: string;
  /** El servidor topa en 500. */
  limit?: number;
}

export interface LogSearchResult {
  lines: LogLineView[];
  nextCursor: string | null;
}

export interface SourceOptions {
  installations: Array<{ id: number; displayName: string; clientId: number | null; systemId: number | null }>;
  aplicativos: string[];
  servidores: string[];
}

// ------------------------------------------------------------ instalaciones

export type InstallationKind = 'CLIENTE' | 'INTERNA';
export type KeyStatus = 'ACTIVA' | 'REVOCADA' | 'SIN_CLAVE';

export interface InstallationView {
  id: number;
  kind: InstallationKind;
  displayName: string;
  clientId: number | null;
  clientName: string | null;
  clientSystemId: number | null;
  systemId: number | null;
  systemName: string | null;
  minLevel: LogLevel;
  keyPrefix: string | null;
  keyStatus: KeyStatus;
  keyCreatedAt: string | null;
  lastSeenAt: string | null;
  sources: Array<{ aplicativo: string; servidor: string; appenderVersion: string | null; lastSeenAt: string }>;
}

/** La clave en claro (`secret`) solo viaja en esta respuesta: no se vuelve a poder leer. */
export interface IssuedKey {
  installation: InstallationView;
  secret: string;
}

export interface CreateInstallationBody {
  kind: InstallationKind;
  /** Solo CLIENTE. */
  clientSystemId?: number;
  /** Solo INTERNA. */
  name?: string;
  /** Solo INTERNA, opcional. */
  systemId?: number;
  minLevel?: LogLevel;
}

export interface UpdateInstallationBody {
  minLevel?: LogLevel;
  /** Solo INTERNA. */
  name?: string;
}

export interface DiskStatus {
  path: string;
  /** `null` si no se pudo medir. */
  usedPct: number | null;
  threshold: number;
  alert: boolean;
  checkedAt: string | null;
}

export interface AppenderManual {
  version: string;
  html: string;
  markdown: string;
}

/** Nombre que manda el servidor en `Content-Disposition`; sin él, uno genérico. */
function filenameFrom(headers: unknown): string | null {
  const h = (headers as { get?: (k: string) => unknown } | undefined)?.get?.('content-disposition');
  if (typeof h !== 'string') return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(h);
  const name = m?.[1] ? decodeURIComponent(m[1]).split(/[/\\]/).pop() : null;
  return name || null;
}

export const monitoringApi = {
  listErrors: (params: ErrorListParams = {}) =>
    api.get<ErrorListResult>('/monitoring/errors', { params }).then((r) => r.data),
  errorsSummary: () =>
    api.get<{ nuevos: number }>('/monitoring/errors/summary').then((r) => r.data),
  getError: (id: number) =>
    api.get<ErrorGroupDetailView>(`/monitoring/errors/${id}`).then((r) => r.data),
  createTicketFromError: (id: number, body: CreateTicketFromErrorBody = {}) =>
    api.post<CreateTicketFromErrorResult>(`/monitoring/errors/${id}/ticket`, body).then((r) => r.data),
  resolveError: (id: number, note?: string) =>
    api.post<ErrorGroupDetailView>(`/monitoring/errors/${id}/resolve`, { note }).then((r) => r.data),
  reopenError: (id: number) =>
    api.post<ErrorGroupDetailView>(`/monitoring/errors/${id}/reopen`).then((r) => r.data),

  searchLogs: (params: LogSearchParams = {}) =>
    api.get<LogSearchResult>('/monitoring/logs', { params }).then((r) => r.data),
  sources: () => api.get<SourceOptions>('/monitoring/sources').then((r) => r.data),

  listInstallations: () =>
    api.get<InstallationView[]>('/monitoring/installations').then((r) => r.data),
  createInstallation: (body: CreateInstallationBody) =>
    api.post<IssuedKey>('/monitoring/installations', body).then((r) => r.data),
  updateInstallation: (id: number, body: UpdateInstallationBody) =>
    api.patch<InstallationView>(`/monitoring/installations/${id}`, body).then((r) => r.data),
  regenerateKey: (id: number) =>
    api.post<IssuedKey>(`/monitoring/installations/${id}/key`).then((r) => r.data),
  revokeKey: (id: number) =>
    api.delete<InstallationView>(`/monitoring/installations/${id}/key`).then((r) => r.data),
  disk: () => api.get<DiskStatus>('/monitoring/disk').then((r) => r.data),

  /** Descarga el zip del appender; el nombre lo manda el servidor. */
  downloadPackage: async (): Promise<void> => {
    const res = await api.get<Blob>('/monitoring/appender/package', { responseType: 'blob' });
    saveAttachmentToDisk(res.data, filenameFrom(res.headers) ?? 'kubo-log-appender.zip');
  },
  manual: () => api.get<AppenderManual>('/monitoring/appender/manual').then((r) => r.data),
};
