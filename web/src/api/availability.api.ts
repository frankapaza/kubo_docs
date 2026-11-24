import { api } from './client';
import { saveAttachmentToDisk } from './ticket-messages.api';

// Tipos copiados a mano del backend (la web no importa de él).

export type CombinedStatus = 'OK' | 'VERIFYING' | 'DEGRADED' | 'DOWN' | 'ROUTE' | 'NO_DATA';
export type TrackerState = 'OK' | 'VERIFYING' | 'FAILED' | 'DEGRADED';
export type Criticality = 'HIGH' | 'MEDIUM' | 'LOW';
export type Protocol = 'TCP' | 'HTTPS' | 'ICMP';
export type EntityStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type IncidentKind = 'DOWN' | 'ROUTE' | 'DEGRADED';

export interface ProbeSide {
  state: TrackerState;
  lastCheckAt: string | null;
  lastLatencyMs: number | null;
}

export interface StateRow {
  serviceId: number;
  serverId: number;
  clientId: number;
  serviceName: string;
  serverName: string;
  criticality: Criticality;
  office: ProbeSide | null;
  datacenter: ProbeSide | null;
  status: CombinedStatus;
  incidentId: number | null;
  parentIncidentId: number | null;
  ticketCode: string | null;
}

export interface StateFilter {
  clientId?: number;
  status?: CombinedStatus;
  serverId?: number;
}

export interface IncidentRow {
  id: number;
  kind: IncidentKind;
  serviceName: string | null;
  serverName: string;
  clientName: string;
  firstFailureAt: string;
  confirmedAt: string;
  recoveredAt: string | null;
  durationMinutes: number;
  ticketId: number | null;
  ticketCode: string | null;
  childCount: number;
  parentId: number | null;
  serverId: number;
}

export interface IncidentList {
  items: IncidentRow[];
  truncated: boolean;
}

export interface IncidentEvent {
  id: number;
  incidentId: number;
  at: string;
  type: string;
  detail: Record<string, unknown> | null;
  authorUserId: number | null;
}

export interface CheckRow {
  id: string;
  serviceId: number;
  kind: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  errorCode: string | null;
  httpStatus: number | null;
}

export interface IncidentDetail {
  incident: IncidentRow & {
    parentId: number | null;
    serverId: number;
    closeReason: string | null;
    acknowledgedBy: number | null;
    acknowledgedAt: string | null;
  };
  children: IncidentRow[];
  events: IncidentEvent[];
  checks: { office: CheckRow[]; datacenter: CheckRow[] };
  diagnosis: string;
  winmtrTarget: string;
}

export interface AckResult {
  incidentId: number;
  acknowledgedBy: number | null;
  acknowledgedAt: string | null;
}

export interface MonitorServer {
  id: number;
  clientId: number;
  name: string;
  host: string;
  role: string | null;
  provider: string | null;
  region: string | null;
  status: EntityStatus;
}

export interface MonitorService {
  id: number;
  serverId: number;
  /** `client_systems.id`. */
  systemId: number | null;
  name: string;
  protocol: Protocol;
  target: string;
  port: number | null;
  latencyThresholdMs: number;
  criticality: Criticality;
  status: EntityStatus;
}

export interface ServerBody {
  clientId?: number;
  name?: string;
  host?: string;
  role?: string;
  provider?: string;
  region?: string;
  status?: EntityStatus;
}

export interface ServiceBody {
  serverId?: number;
  systemId?: number;
  name?: string;
  protocol?: Protocol;
  target?: string;
  port?: number;
  latencyThresholdMs?: number;
  criticality?: Criticality;
  status?: EntityStatus;
}

export interface TestResult {
  ok: boolean;
  durationMs: number;
  errorCode: string | null;
  httpStatus: number | null;
}

export interface ProbeInfo {
  id: number;
  code: string;
  kind: 'OFFICE' | 'DATACENTER';
  lastSeenAt: string | null;
  version: string | null;
  clockSkewMs: number | null;
  hasToken: boolean;
}

// MySQL entrega los bigint como texto: se normalizan los ids a número.
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const normServer = (s: MonitorServer): MonitorServer => ({ ...s, id: num(s.id), clientId: num(s.clientId) });
const normService = (s: MonitorService): MonitorService => ({
  ...s,
  id: num(s.id),
  serverId: num(s.serverId),
  systemId: numOrNull(s.systemId),
  port: numOrNull(s.port),
  latencyThresholdMs: num(s.latencyThresholdMs),
});

function filenameFrom(headers: unknown): string | null {
  const h = (headers as { get?: (k: string) => unknown } | undefined)?.get?.('content-disposition');
  if (typeof h !== 'string') return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(h);
  const name = m?.[1] ? decodeURIComponent(m[1]).split(/[/\\]/).pop() : null;
  return name || null;
}

export const availabilityApi = {
  state: (params: StateFilter = {}) =>
    api.get<StateRow[]>('/availability/state', { params }).then((r) => r.data),

  /** Descarga el CSV del servidor con los mismos filtros de la tabla. */
  downloadStateCsv: async (params: StateFilter = {}): Promise<void> => {
    const res = await api.get<Blob>('/availability/state.csv', { params, responseType: 'blob' });
    saveAttachmentToDisk(res.data, filenameFrom(res.headers) ?? 'estado-disponibilidad.csv');
  },

  checkNow: (serviceId: number) =>
    api.post<{ serviceId: number; orders: number }>(`/availability/services/${serviceId}/check-now`).then((r) => r.data),

  listIncidents: (params: { open?: boolean; clientId?: number; from?: string; to?: string; limit?: number } = {}) =>
    api.get<IncidentList>('/availability/incidents', { params }).then((r) => r.data),

  incidentDetail: (id: number) =>
    api.get<IncidentDetail>(`/availability/incidents/${id}`).then((r) => r.data),

  acknowledge: (id: number) =>
    api.post<AckResult>(`/availability/incidents/${id}/ack`).then((r) => r.data),

  addNote: (id: number, text: string) =>
    api.post<IncidentEvent>(`/availability/incidents/${id}/notes`, { text }).then((r) => r.data),

  listServers: () =>
    api.get<MonitorServer[]>('/availability/servers').then((r) => r.data.map(normServer)),
  createServer: (body: ServerBody) =>
    api.post<MonitorServer>('/availability/servers', body).then((r) => normServer(r.data)),
  updateServer: (id: number, body: ServerBody) =>
    api.patch<MonitorServer>(`/availability/servers/${id}`, body).then((r) => normServer(r.data)),

  listServices: (serverId?: number) =>
    api.get<MonitorService[]>('/availability/services', { params: { serverId } }).then((r) => r.data.map(normService)),
  createService: (body: ServiceBody) =>
    api.post<MonitorService>('/availability/services', body).then((r) => normService(r.data)),
  updateService: (id: number, body: ServiceBody) =>
    api.patch<MonitorService>(`/availability/services/${id}`, body).then((r) => normService(r.data)),
  testService: (serviceId: number) =>
    api.post<TestResult>('/availability/services/test', { serviceId }).then((r) => r.data),

  listProbes: () => api.get<ProbeInfo[]>('/availability/probes').then((r) => r.data),
  issueProbeToken: (id: number) =>
    api.post<{ token: string }>(`/availability/probes/${id}/token`).then((r) => r.data),
  revokeProbeToken: (id: number) =>
    api.delete<void>(`/availability/probes/${id}/token`).then(() => undefined),
};
