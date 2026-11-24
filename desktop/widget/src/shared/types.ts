/**
 * Tipos copiados a mano del motor (el widget no importa de desktop/engine):
 * - desktop/engine/src/engine.ts             -> EngineStatus
 * - desktop/engine/src/events/diff-states.ts -> EngineEvent, EngineEventKind
 * - desktop/engine/src/central-client.ts     -> CombinedStateRow, ProbeView, CombinedStatus
 * - packages/monitoring-core/src/tracker.ts  -> TrackerState
 * - packages/monitoring-core/src/types.ts    -> Criticality
 * Si cambian allí, actualizar aquí.
 */
export type Criticality = 'HIGH' | 'MEDIUM' | 'LOW';
export type TrackerState = 'OK' | 'VERIFYING' | 'FAILED' | 'DEGRADED';
export type CombinedStatus = 'OK' | 'VERIFYING' | 'DEGRADED' | 'DOWN' | 'ROUTE' | 'NO_DATA';

export interface ProbeView {
  state: TrackerState;
  lastCheckAt: string | null;
  lastLatencyMs: number | null;
}

export interface CombinedStateRow {
  serviceId: number;
  serverId: number;
  clientId: number;
  serviceName: string;
  serverName: string;
  criticality: Criticality;
  /** null = sin datos de esa sonda. */
  office: ProbeView | null;
  datacenter: ProbeView | null;
  status: CombinedStatus;
  incidentId: number | null;
  parentIncidentId: number | null;
  ticketCode: string | null;
}

export interface EngineStatus {
  engine: { version: string; startedAt: string };
  /** Origen de la central (sin barra final). */
  centralUrl: string;
  central: {
    reachable: boolean;
    lastSyncAt: string | null;
    consecutiveFailures: number;
    rejecting: boolean;
  };
  officeOutage: boolean;
  pending: number;
  services: CombinedStateRow[];
}

export type EngineEventKind =
  | 'INCIDENT_OPENED'
  | 'INCIDENT_RECOVERED'
  | 'INCIDENT_UPGRADED'
  | 'DEGRADED_STARTED'
  | 'DEGRADED_CLEARED'
  | 'OFFICE_OUTAGE_STARTED'
  | 'OFFICE_OUTAGE_ENDED'
  | 'CENTRAL_UNREACHABLE'
  | 'CENTRAL_BACK'
  | 'CENTRAL_REJECTING';

export interface EngineEvent {
  id: number;
  /** ISO, hora de la PC. */
  at: string;
  kind: EngineEventKind;
  /** `parentIncidentId ?? incidentId`. */
  incidentKey: number | null;
  incidentKind: 'DOWN' | 'ROUTE' | 'DEGRADED' | null;
  serverName: string | null;
  serviceNames: string[];
  criticality: Criticality | null;
  ticketCode: string | null;
  notify: boolean;
}
