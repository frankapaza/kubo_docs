import type { Criticality, TrackerState } from '../core';

export type CombinedStatus = 'OK' | 'VERIFYING' | 'DEGRADED' | 'DOWN' | 'ROUTE' | 'NO_DATA';

export interface ProbeView {
  state: TrackerState;
  lastCheckAt: Date | null;
  lastLatencyMs: number | null;
}

export interface CombinedStateRow {
  serviceId: number;
  serverId: number;
  clientId: number;
  serviceName: string;
  serverName: string;
  criticality: Criticality;
  /** Protocolo, destino y umbral: la pantalla de Estado separa los pings de red (ICMP). */
  protocol: string;
  target: string;
  latencyThresholdMs: number;
  office: ProbeView | null;
  datacenter: ProbeView | null;
  status: CombinedStatus;
  incidentId: number | null;
  parentIncidentId: number | null;
  /** Lo rellena la API del personal (Task 12); la sonda no recibe tickets. */
  ticketCode: string | null;
  /** Hay una ventana de mantenimiento activa que cubre al servicio (de él o de su servidor). */
  maintenance: boolean;
}

/** Franjas sin comprobación tras las cuales una sonda se da por muda. */
const STALE_SLOTS = 3;

function isStale(view: ProbeView | null, now: Date, intervalMs: number): boolean {
  if (!view || !view.lastCheckAt) return true;
  return now.getTime() - view.lastCheckAt.getTime() > STALE_SLOTS * intervalMs;
}

/**
 * Estado combinado de un servicio visto por las dos sondas. Prioridad:
 * incidente DOWN, incidente ROUTE, sonda VERIFYING/FAILED sin incidente,
 * DEGRADED (incidente o sonda), las dos sin datos en 3 franjas, y si no OK.
 */
export function combineStatus(
  office: ProbeView | null,
  dc: ProbeView | null,
  openIncidentKind: 'DOWN' | 'ROUTE' | 'DEGRADED' | null,
  now: Date,
  intervalMs: number,
): CombinedStatus {
  if (openIncidentKind === 'DOWN') return 'DOWN';
  if (openIncidentKind === 'ROUTE') return 'ROUTE';
  const states = [office?.state, dc?.state];
  if (states.some((s) => s === 'VERIFYING' || s === 'FAILED')) return 'VERIFYING';
  if (openIncidentKind === 'DEGRADED' || states.some((s) => s === 'DEGRADED')) return 'DEGRADED';
  if (isStale(office, now, intervalMs) && isStale(dc, now, intervalMs)) return 'NO_DATA';
  return 'OK';
}
