import type { Criticality } from '@kubo/monitoring-core';
import type { CombinedStateRow } from '../central-client';

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
  /** Autoincremental del diario. */
  id: number;
  /** ISO, hora de la PC. */
  at: string;
  kind: EngineEventKind;
  /** `parentIncidentId ?? incidentId` (decisión 19). */
  incidentKey: number | null;
  incidentKind: 'DOWN' | 'ROUTE' | 'DEGRADED' | null;
  serverName: string | null;
  /** Los servicios afectados (uno o varios), en orden estable. */
  serviceNames: string[];
  /** La más alta de los afectados. */
  criticality: Criticality | null;
  ticketCode: string | null;
  /** Regla de la tabla «Notificaciones de Windows». */
  notify: boolean;
}

export type EngineEventDraft = Omit<EngineEvent, 'id' | 'at'>;

const RANK: Record<Criticality, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

type Category = 'DOWN' | 'ROUTE' | 'DEGRADED' | null;

interface Group {
  incidentKey: number | null;
  rows: CombinedStateRow[];
}

/** Clave de agrupación: el incidente (de servidor si lo hay); sin incidente, el propio servicio. */
function groupKey(r: CombinedStateRow): { key: string; incidentKey: number | null } {
  const incidentKey = r.parentIncidentId ?? r.incidentId;
  return incidentKey === null ? { key: `s:${r.serviceId}`, incidentKey } : { key: `i:${incidentKey}`, incidentKey };
}

function groupRows(rows: CombinedStateRow[]): Map<string, Group> {
  const out = new Map<string, Group>();
  for (const r of rows) {
    const { key, incidentKey } = groupKey(r);
    const g = out.get(key);
    if (g) g.rows.push(r);
    else out.set(key, { incidentKey, rows: [r] });
  }
  return out;
}

function category(g: Group | undefined): Category {
  if (!g) return null;
  if (g.rows.some((r) => r.status === 'DOWN')) return 'DOWN';
  if (g.rows.some((r) => r.status === 'ROUTE')) return 'ROUTE';
  if (g.rows.some((r) => r.status === 'DEGRADED')) return 'DEGRADED';
  return null;
}

const isIncident = (c: Category): c is 'DOWN' | 'ROUTE' => c === 'DOWN' || c === 'ROUTE';

/** El evento de un grupo: solo con las filas que están en el estado del evento. */
function toDraft(kind: EngineEventKind, g: Group, cat: 'DOWN' | 'ROUTE' | 'DEGRADED'): EngineEventDraft {
  const statuses: string[] = cat === 'DEGRADED' ? ['DEGRADED'] : ['DOWN', 'ROUTE'];
  const affected = g.rows.filter((r) => statuses.includes(r.status));
  const rows = affected.length > 0 ? affected : g.rows;
  let criticality: Criticality | null = null;
  for (const r of rows) if (criticality === null || RANK[r.criticality] > RANK[criticality]) criticality = r.criticality;
  const notify = criticality === 'HIGH' && (kind === 'INCIDENT_OPENED' || kind === 'INCIDENT_RECOVERED' || kind === 'INCIDENT_UPGRADED');
  return {
    kind,
    incidentKey: g.incidentKey,
    incidentKind: cat,
    serverName: rows[0]?.serverName ?? null,
    serviceNames: [...new Set(rows.map((r) => r.serviceName))].sort((a, b) => a.localeCompare(b)),
    criticality,
    ticketCode: rows.find((r) => r.ticketCode !== null)?.ticketCode ?? g.rows.find((r) => r.ticketCode !== null)?.ticketCode ?? null,
    notify,
  };
}

/**
 * Eventos entre dos estados combinados FRESCOS (decisión 2). Pura.
 * Agrupa por `incidentKey`: una caída de servidor (varios servicios con el mismo
 * `parentIncidentId`) es un solo evento. Con `prev === null` (primer estado tras
 * arrancar) no se emite nada.
 */
export function diffStates(prev: CombinedStateRow[] | null, next: CombinedStateRow[]): EngineEventDraft[] {
  if (prev === null) return [];
  const before = groupRows(prev);
  const after = groupRows(next);
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const out: EngineEventDraft[] = [];
  for (const key of keys) {
    const p = before.get(key);
    const n = after.get(key);
    const pc = category(p);
    const nc = category(n);
    if (pc === nc) continue;

    if (isIncident(pc) && !isIncident(nc)) out.push(toDraft('INCIDENT_RECOVERED', p!, pc));
    if (pc === 'DEGRADED') out.push(toDraft('DEGRADED_CLEARED', p!, 'DEGRADED'));

    if (isIncident(nc) && !isIncident(pc)) out.push(toDraft('INCIDENT_OPENED', n!, nc));
    else if (pc === 'ROUTE' && nc === 'DOWN') out.push(toDraft('INCIDENT_UPGRADED', n!, 'DOWN'));
    if (nc === 'DEGRADED') out.push(toDraft('DEGRADED_STARTED', n!, 'DEGRADED'));
  }
  return out;
}
