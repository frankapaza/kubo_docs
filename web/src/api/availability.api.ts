import { api } from './client';
import { saveAttachmentToDisk } from './ticket-messages.api';

// Tipos copiados a mano del backend (la web no importa de él).

export type CombinedStatus = 'OK' | 'VERIFYING' | 'DEGRADED' | 'DOWN' | 'ROUTE' | 'NO_DATA';
export type TrackerState = 'OK' | 'VERIFYING' | 'FAILED' | 'DEGRADED';
export type Criticality = 'HIGH' | 'MEDIUM' | 'LOW';
export type Protocol = 'TCP' | 'HTTPS' | 'HTTP' | 'ICMP';
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
  /** Hay una ventana de mantenimiento activa que alcanza al servicio. */
  maintenance: boolean;
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
  evidence: EvidenceView[];
}

export type EvidenceOrigin = 'OFICINA' | 'SERVIDOR' | 'OTRO';

export interface EvidenceView {
  id: number;
  capturedAt: string;
  origin: EvidenceOrigin;
  notes: string | null;
  fileName: string;
  sizeBytes: number;
  createdByName: string | null;
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
  agentLastSeenAt: string | null;
  agentTokenCreatedAt: string | null;
  agentWatchServices: string[] | null;
  agentVersion: string | null;
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
  agentWatchServices?: string[] | null;
}

export interface ServiceBody {
  serverId?: number;
  systemId?: number;
  name?: string;
  protocol?: Protocol;
  target?: string;
  port?: number | null;
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

export interface AgentDiskView {
  name: string;
  totalBytes: number;
  freeBytes: number;
  freePct: number | null;
  daysToFull: number | null;
  /** Días de historia del disco (la estimación pide 3). */
  trendDays: number;
}

export type HistoryRange = 'day' | 'month' | 'year';

/** Un tramo del historial del servidor. Sin muestras: samples 0 y métricas null. */
export interface HistoryPoint {
  /** 'YYYY-MM-DDTHH:mm' (Lima) en day, 'YYYY-MM-DD' en month, 'YYYY-MM' en year. */
  key: string;
  from: string;
  samples: number;
  cpuAvg: number | null;
  cpuMax: number | null;
  ramAvg: number | null;
  ramMax: number | null;
  errors: number;
}

export interface AgentView {
  lastSampleAt: string | null;
  agentVersion: string | null;
  cpuPct: number | null;
  ramPct: number | null;
  disks: AgentDiskView[];
  iisPools: Array<{ name: string; state: string }> | null;
  services: Array<{ name: string; status: string }>;
  eventErrors24h: number;
  series24h: Array<{ at: string; cpuPct: number; ramPct: number }>;
}

export type MaintenanceStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED';

export interface MaintenanceView {
  id: number;
  serverId: number | null;
  serviceId: number | null;
  startsAt: string;
  endsAt: string;
  reason: string;
  createdBy: number | null;
  createdAt: string;
  targetLabel: string;
  status: MaintenanceStatus;
}

export interface MaintenanceBody {
  serverId?: number;
  serviceId?: number;
  /** ISO con desfase explícito (p. ej. «…-05:00»). */
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface ReportListItem {
  month: string;
  partial: boolean;
  generatedAt: string;
}

/** Contenido congelado del informe mensual (copiado de AvailabilityReportData del backend). */
export interface AvailabilityReportData {
  version: 1;
  clientId: number;
  clientName: string;
  month: string;
  partial: boolean;
  from: string;
  to: string;
  generatedAt: string;
  criteria: string[];
  totals: {
    availabilityPct: number | null;
    peruAccessPct: number | null;
    mttrMinutes: number | null;
    incidents: number;
    downMinutes: number;
    routeMinutes: number;
    maintenanceMinutes: number;
  };
  services: Array<{
    serviceId: number;
    serviceName: string;
    serverName: string;
    systemName: string | null;
    criticality: Criticality;
    availabilityPct: number | null;
    peruAccessPct: number | null;
    downMinutes: number;
    routeMinutes: number;
    maintenanceMinutes: number;
    incidents: number;
    latency: { office: { p50: number | null; p95: number | null }; datacenter: { p50: number | null; p95: number | null } };
    coverage: { office: number | null; datacenter: number | null };
  }>;
  incidents: Array<{
    incidentId: number;
    kind: 'DOWN' | 'ROUTE';
    serverName: string;
    serviceNames: string[];
    firstFailureAt: string;
    recoveredAt: string | null;
    minutesInMonth: number;
    ticketId: number | null;
    ticketCode: string | null;
    evidence: Array<{ id: number; origin: string; capturedAt: string; fileName: string }>;
  }>;
  noDataWindows: Array<{ probeCode: string; cause: 'OFFICE_OUTAGE' | 'PROBE_SILENT'; startedAt: string; endedAt: string; minutes: number }>;
  maintenance: Array<{ targetLabel: string; startsAt: string; endsAt: string; reason: string; minutesInMonth: number }>;
  servers: Array<{
    serverName: string;
    cpuP95: number | null;
    ramP95: number | null;
    disksAtClose: Array<{ name: string; freePct: number }>;
  }>;
}

// MySQL entrega los bigint como texto: se normalizan los ids a número.
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const normServer = (s: MonitorServer): MonitorServer => ({
  ...s,
  id: num(s.id),
  clientId: num(s.clientId),
  agentLastSeenAt: s.agentLastSeenAt ?? null,
  agentTokenCreatedAt: s.agentTokenCreatedAt ?? null,
  agentWatchServices: s.agentWatchServices ?? null,
  agentVersion: s.agentVersion ?? null,
});
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

export interface ImportRowResult {
  line: number;
  status: 'NEW' | 'DUPLICATE' | 'INVALID';
  errors: string[];
  serverAction: 'CREATE' | 'REUSE' | null;
  data: {
    clientId: number;
    server: { name: string; host: string };
    service: { name: string; protocol: Protocol; target: string; port: number | null };
  } | null;
}
export interface ImportPreview { rows: ImportRowResult[]; summary: { new: number; duplicate: number; invalid: number } }
export interface ImportCommitResult { createdServers: number; createdServices: number; skipped: number }

export const availabilityApi = {
  importPreview: (csv: string) =>
    api.post<ImportPreview>('/availability/import/preview', { csv }).then((r) => r.data),
  importCommit: (csv: string) =>
    api.post<ImportCommitResult>('/availability/import/commit', { csv }).then((r) => r.data),

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

  uploadEvidence: (incidentId: number, file: File, body: { origin: EvidenceOrigin; notes?: string; capturedAt?: string }) => {
    const fd = new FormData();
    fd.append('origin', body.origin);
    if (body.notes) fd.append('notes', body.notes);
    if (body.capturedAt) fd.append('capturedAt', body.capturedAt);
    fd.append('file', file);
    return api.post<EvidenceView>(`/availability/incidents/${incidentId}/evidence`, fd).then((r) => r.data);
  },

  /** Descarga la evidencia con la sesión del usuario (fetch autenticado + blob). */
  downloadEvidence: async (e: { id: number; fileName: string }): Promise<void> => {
    const res = await api.get<Blob>(`/availability/evidence/${e.id}/file`, { responseType: 'blob' });
    saveAttachmentToDisk(res.data, filenameFrom(res.headers) ?? e.fileName);
  },

  deleteEvidence: (id: number) => api.delete(`/availability/evidence/${id}`).then(() => undefined),

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

  // ---- Agente de servidor ----
  serverHistory: (serverId: number, range: HistoryRange) =>
    api.get<{ range: HistoryRange; points: HistoryPoint[] }>(`/availability/servers/${serverId}/history`, { params: { range } }).then((r) => r.data),
  agentView: (serverId: number) => api.get<AgentView>(`/availability/servers/${serverId}/agent`).then((r) => r.data),
  /** El token y el script salen una sola vez: no se guardan en la caché de react-query. */
  issueAgentToken: (serverId: number) =>
    api.post<{ token: string; installScript: string }>(`/availability/servers/${serverId}/agent-token`).then((r) => r.data),
  revokeAgentToken: (serverId: number) =>
    api.delete<void>(`/availability/servers/${serverId}/agent-token`).then(() => undefined),
  /** Guarda el script de instalación (texto con el token) como archivo. */
  saveInstallScript: (script: string): void => {
    saveAttachmentToDisk(new Blob([script], { type: 'text/plain;charset=utf-8' }), 'install-kubo-agent.ps1');
  },

  // ---- Mantenimientos ----
  listMaintenance: (params: { from?: string; to?: string } = {}) =>
    api.get<MaintenanceView[]>('/availability/maintenance', { params }).then((r) =>
      r.data.map((m) => ({ ...m, id: num(m.id), serverId: numOrNull(m.serverId), serviceId: numOrNull(m.serviceId) })),
    ),
  createMaintenance: (body: MaintenanceBody) => api.post<MaintenanceView>('/availability/maintenance', body).then((r) => r.data),
  endMaintenance: (id: number) => api.post<MaintenanceView>(`/availability/maintenance/${id}/end`).then((r) => r.data),
  deleteMaintenance: (id: number) => api.delete<void>(`/availability/maintenance/${id}`).then(() => undefined),

  // ---- Informe mensual ----
  listReports: (clientId: number) =>
    api.get<ReportListItem[]>('/availability/reports', { params: { clientId } }).then((r) => r.data),
  getReport: (clientId: number, month: string) =>
    api.get<AvailabilityReportData>(`/availability/reports/${clientId}/${month}`).then((r) => r.data),
  generateReport: (clientId: number, month: string) =>
    api.post<AvailabilityReportData>(`/availability/reports/${clientId}/${month}/generate`).then((r) => r.data),
};
