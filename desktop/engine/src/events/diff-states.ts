import type { Criticality } from '@kubo/monitoring-core';
import type { CombinedStateRow, ServerAlert, ServerAlertKind } from '../central-client';

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
  | 'CENTRAL_REJECTING'
  | 'SERVER_ALERT_STARTED'
  | 'SERVER_ALERT_CLEARED';

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
  /** Solo en las alertas de servidor; null en el resto. */
  serverId: number | null;
  alertKind: ServerAlertKind | null;
  /** «C: 9 % libre» o «sin datos desde 14:32»; null fuera de las alertas de servidor. */
  detail: string | null;
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
    serverId: null,
    alertKind: null,
    detail: null,
    notify,
  };
}

const incidentRows = (g: Group): CombinedStateRow[] => g.rows.filter((r) => r.status === 'DOWN' || r.status === 'ROUTE');

/** serviceId → clave del grupo en caída (DOWN/ROUTE) en el que está ese servicio. */
function incidentServices(groups: Map<string, Group>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [key, g] of groups) {
    if (!isIncident(category(g))) continue;
    for (const r of incidentRows(g)) out.set(r.serviceId, key);
  }
  return out;
}

/**
 * Eventos entre dos estados combinados FRESCOS (decisión 2). Pura.
 * Agrupa por `incidentKey`: una caída de servidor (varios servicios con el mismo
 * `parentIncidentId`) es un solo evento. Con `prev === null` (primer estado tras
 * arrancar) no se emite nada.
 *
 * Absorción (decisión 19): cuando la central reagrupa el incidente de un servicio bajo
 * uno de servidor, la clave cambia pero el servicio sigue caído. La clave vieja no se
 * da por recuperada si todos sus servicios siguen caídos bajo otra clave, y si se recupera
 * solo en parte, el RECOVERED nombra (y avisa según) solo lo recuperado. La nueva se anota
 * como OPENED, que solo avisa si es Alta y ninguno de los servicios heredados que están en ella
 * era Alta (esos ya avisaron: una caída de servidor avisa una sola vez); o como UPGRADED si todo lo heredado era ROUTE y ahora es DOWN, que avisa como
 * el ROUTE→DOWN de la misma clave (si es Alta).
 */
export function diffStates(prev: CombinedStateRow[] | null, next: CombinedStateRow[]): EngineEventDraft[] {
  if (prev === null) return [];
  const before = groupRows(prev);
  const after = groupRows(next);
  const prevSvc = incidentServices(before);
  const nextSvc = incidentServices(after);
  // Claves que dejan de estar caídas y no siguen caídas bajo otra clave: se recuperan.
  const recovered = new Set<string>();
  for (const [key, p] of before) {
    if (!isIncident(category(p)) || isIncident(category(after.get(key)))) continue;
    const moved = incidentRows(p).every((r) => {
      const k = nextSvc.get(r.serviceId);
      return k !== undefined && k !== key;
    });
    if (!moved) recovered.add(key);
  }
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const out: EngineEventDraft[] = [];
  for (const key of keys) {
    const p = before.get(key);
    const n = after.get(key);
    const pc = category(p);
    const nc = category(n);
    if (pc === nc) continue;

    if (isIncident(pc) && recovered.has(key)) {
      // Solo lo que de verdad se recuperó: lo que sigue caído bajo otra clave no se nombra
      // (ni cuenta para la criticidad y el aviso).
      const done: Group = { incidentKey: p!.incidentKey, rows: incidentRows(p!).filter((r) => !nextSvc.has(r.serviceId)) };
      out.push(toDraft('INCIDENT_RECOVERED', done, category(done) as 'DOWN' | 'ROUTE'));
    }
    if (pc === 'DEGRADED') out.push(toDraft('DEGRADED_CLEARED', p!, 'DEGRADED'));

    if (isIncident(nc) && !isIncident(pc)) {
      const carriedKeys = new Set<string>();
      for (const r of incidentRows(n!)) {
        const k = prevSvc.get(r.serviceId);
        if (k !== undefined && k !== key) carriedKeys.add(k);
      }
      if (carriedKeys.size === 0) {
        out.push(toDraft('INCIDENT_OPENED', n!, nc));
      } else {
        const carried = [...carriedKeys].map((k) => before.get(k)!);
        // Una caída de servidor avisa una sola vez: si alguno de los servicios heredados que están en
        // este grupo era Alta en `prev`, ese aviso ya se dio (un RECOVERED no los nombra) y no se repite.
        const carriedHighHere = carried.some((g) =>
          incidentRows(g).some((r) => r.criticality === 'HIGH' && nextSvc.get(r.serviceId) === key),
        );
        const allRoute = carried.every((g) => category(g) === 'ROUTE');
        if (allRoute && nc === 'DOWN') {
          // Se agravó (solo se había avisado «sin acceso»): avisa igual que el ROUTE→DOWN de la misma clave.
          out.push(toDraft('INCIDENT_UPGRADED', n!, 'DOWN'));
        } else {
          const e = toDraft('INCIDENT_OPENED', n!, nc);
          out.push({ ...e, notify: e.criticality === 'HIGH' && !carriedHighHere });
        }
      }
    } else if (pc === 'ROUTE' && nc === 'DOWN') out.push(toDraft('INCIDENT_UPGRADED', n!, 'DOWN'));
    if (nc === 'DEGRADED') out.push(toDraft('DEGRADED_STARTED', n!, 'DEGRADED'));
  }
  return out;
}

/**
 * Mantenimiento en el motor (decisión 5): una fila con `maintenance` se «congela» en la fila
 * previa del mismo servicio (sin fila previa, la misma fila en OK y sin incidentes). Conserva
 * `maintenance: true` para que el widget la cuente aparte. El motor compara y guarda el resultado:
 * no hay avisos al entrar ni durante la ventana; al salir, `diffStates` ve el cambio real.
 */
export function maskMaintenance(prev: CombinedStateRow[] | null, next: CombinedStateRow[]): CombinedStateRow[] {
  const before = new Map((prev ?? []).map((r) => [r.serviceId, r]));
  return next.map((r): CombinedStateRow => {
    if (r.maintenance !== true) return r;
    const p = before.get(r.serviceId);
    return p ? { ...p, maintenance: true } : { ...r, status: 'OK', incidentId: null, parentIncidentId: null };
  });
}

/**
 * Clave de una alerta de servidor: `serverId:kind:unidad`. La unidad es el detalle sin cifras
 * («C: 9 % libre» → «C:»), así un 9 % → 8 % en la misma unidad no es una alerta nueva; el
 * agente mudo no tiene unidad (la hora del detalle tampoco cuenta).
 */
export function serverAlertKey(a: Pick<ServerAlert, 'serverId' | 'kind' | 'detail'>): string {
  const unit = a.kind === 'DISK_LOW' ? a.detail.replace(/\s*\d+\s*%\s*libre\s*$/, '').trim() : '';
  return `${a.serverId}:${a.kind}:${unit}`;
}

function alertDraft(kind: 'SERVER_ALERT_STARTED' | 'SERVER_ALERT_CLEARED', a: ServerAlert): EngineEventDraft {
  return {
    kind,
    incidentKey: null,
    incidentKind: null,
    serverName: a.serverName,
    serviceNames: [],
    criticality: null,
    ticketCode: null,
    serverId: a.serverId,
    alertKind: a.kind,
    detail: a.detail,
    // Decisión 11: solo el disco bajo da notificación de Windows; el agente mudo va por correo.
    notify: kind === 'SERVER_ALERT_STARTED' && a.kind === 'DISK_LOW',
  };
}

/**
 * Eventos entre dos listas de alertas de servidor. Pura. Con `prev === null` (primer arranque sin
 * alertas guardadas) no emite nada. Las que desaparecen salen como CLEARED con su último detalle.
 */
export function diffServerAlerts(prev: ServerAlert[] | null, next: ServerAlert[]): EngineEventDraft[] {
  if (prev === null) return [];
  const before = new Map(prev.map((a) => [serverAlertKey(a), a]));
  const after = new Map(next.map((a) => [serverAlertKey(a), a]));
  const out: EngineEventDraft[] = [];
  for (const [k, a] of before) if (!after.has(k)) out.push(alertDraft('SERVER_ALERT_CLEARED', a));
  for (const [k, a] of after) if (!before.has(k)) out.push(alertDraft('SERVER_ALERT_STARTED', a));
  return out;
}
