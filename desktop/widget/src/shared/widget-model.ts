import type { CombinedStateRow, EngineStatus, ProbeView, ServerAlert, ServerAlertKind } from './types';

export type Tone = 'ok' | 'red' | 'amber' | 'grey';

export interface WidgetRow {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  incidentId: number | null;
  /** Solo en las filas de alerta de servidor: el clic abre la ficha del servidor. */
  serverId?: number;
  children: WidgetRow[];
}

/** Texto de cada tipo de alerta de servidor (fila del widget y notificación). */
export const ALERT_LABEL: Record<ServerAlertKind, string> = {
  DISK_LOW: 'Disco con poco espacio',
  AGENT_SILENT: 'Agente sin datos',
};

/**
 * Clave de una alerta de servidor (la misma regla que `serverAlertKey` del motor): la unidad sin
 * cifras para el disco («C: 9 % libre» → «C:»), vacía para el agente mudo.
 */
export function serverAlertKey(serverId: number, kind: ServerAlertKind, detail: string): string {
  const unit = kind === 'DISK_LOW' ? detail.replace(/\s*\d+\s*%\s*libre\s*$/, '').trim() : '';
  return `${serverId}:${kind}:${unit}`;
}

/** Ficha del servidor en la web (`centralUrl` ya viene sin barra final). */
export function serverUrl(centralUrl: string, serverId: number): string {
  return `${centralUrl}/monitoreo/servidores?serverId=${serverId}`;
}

function alertRow(a: ServerAlert): WidgetRow {
  return {
    key: `a:${serverAlertKey(a.serverId, a.kind, a.detail)}`,
    tone: 'amber',
    title: `${ALERT_LABEL[a.kind]} · ${a.serverName} · ${a.detail}`,
    detail: '',
    incidentId: null,
    serverId: a.serverId,
    children: [],
  };
}

export interface WidgetModel {
  tone: Tone;
  headline: string;
  /** hh:mm, hora de Lima. */
  time: string;
  rows: WidgetRow[];
  expanded: boolean;
}

export type EngineReach =
  | { kind: 'ok'; status: EngineStatus }
  | { kind: 'connecting' }
  | { kind: 'down' }
  | { kind: 'forbidden' };

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;

export function limaTime(now: Date): string {
  const d = new Date(now.getTime() + LIMA_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function mark(view: ProbeView | null, noData: boolean): string {
  if (noData || !view || !view.lastCheckAt) return '–';
  switch (view.state) {
    case 'OK': return '✓';
    case 'FAILED': return '✕';
    case 'VERIFYING': return '…';
    case 'DEGRADED': return '~';
  }
}

function marks(r: CombinedStateRow): string {
  const noData = r.status === 'NO_DATA';
  return `Perú ${mark(r.office, noData)} · Servidor ${mark(r.datacenter, noData)}`;
}

function withTicket(base: string, ticket: string | null): string {
  return ticket ? `${base} · ${ticket}` : base;
}

function rowTone(r: CombinedStateRow): Tone | null {
  switch (r.status) {
    case 'DOWN':
    case 'ROUTE': return 'red';
    case 'VERIFYING':
    case 'DEGRADED': return 'amber';
    default: return null;
  }
}

function worst(tones: Tone[]): Tone {
  return tones.includes('red') ? 'red' : tones.includes('amber') ? 'amber' : 'ok';
}

function serviceRow(r: CombinedStateRow, tone: Tone): WidgetRow {
  return { key: `s:${r.serviceId}`, tone, title: r.serviceName, detail: withTicket(marks(r), r.ticketCode), incidentId: r.incidentId, children: [] };
}

function problemRows(status: EngineStatus): WidgetRow[] {
  const servers = new Map<number, { rows: WidgetRow[]; src: CombinedStateRow[] }>();
  const rows: WidgetRow[] = [];
  for (const r of status.services) {
    // En mantenimiento no es un problema: la barra solo los cuenta (decisión 5).
    if (r.maintenance === true) continue;
    const tone = rowTone(r);
    if (tone === null) continue;
    const child = serviceRow(r, tone);
    if (r.parentIncidentId === null) {
      rows.push(child);
      continue;
    }
    const group = servers.get(r.parentIncidentId);
    if (group) {
      group.rows.push(child);
      group.src.push(r);
      continue;
    }
    const g = { rows: [child], src: [r] };
    servers.set(r.parentIncidentId, g);
    rows.push({
      key: `i:${r.parentIncidentId}`,
      tone,
      title: r.serverName,
      detail: '',
      incidentId: r.parentIncidentId,
      children: g.rows,
    });
  }
  for (const row of rows) {
    if (row.children.length === 0) continue;
    row.tone = worst(row.children.map((c) => c.tone));
    const g = servers.get(row.incidentId as number)!;
    const lead = g.src.find((r) => rowTone(r) === 'red') ?? g.src[0];
    row.detail = withTicket(marks(lead), g.src.find((r) => r.ticketCode)?.ticketCode ?? null);
  }
  const extra: WidgetRow[] = (status.serverAlerts ?? []).map(alertRow);
  // Sin internet en la oficina tampoco hay central: es el mismo corte, solo la fila de oficina.
  // `reachable` solo cuenta fallos reales de red: si es false, la central no responde aunque el corte
  // de rechazo siga abierto; si responde y rechaza, «rechaza».
  const centralTitle = status.officeOutage
    ? null
    : !status.central.reachable
      ? 'La central no responde'
      : status.central.rejecting
        ? 'La central rechaza los envíos'
        : null;
  if (centralTitle) extra.push({ key: 'central', tone: 'amber', title: centralTitle, detail: '', incidentId: null, children: [] });
  if (status.officeOutage) {
    extra.push({ key: 'office', tone: 'amber', title: 'Sin internet en la oficina', detail: '', incidentId: null, children: [] });
  }
  const all = [...rows, ...extra];
  // Estable: rojo primero, luego ámbar.
  return [...all.filter((r) => r.tone === 'red'), ...all.filter((r) => r.tone !== 'red')];
}

export function deriveModel(reach: EngineReach, now: Date): WidgetModel {
  const time = limaTime(now);
  switch (reach.kind) {
    case 'connecting': return { tone: 'grey', headline: 'Conectando con el motor…', time, rows: [], expanded: false };
    case 'down': return { tone: 'grey', headline: 'El motor no responde', time, rows: [], expanded: false };
    case 'forbidden': return { tone: 'grey', headline: 'Sin permiso para leer el monitor', time, rows: [], expanded: false };
  }
  const rows = problemRows(reach.status);
  const inMaintenance = reach.status.services.filter((r) => r.maintenance === true).length;
  const tail = inMaintenance > 0 ? ` · ${inMaintenance} en mantenimiento` : '';
  if (rows.length === 0) return { tone: 'ok', headline: `KUBO · Todo operativo${tail}`, time, rows, expanded: false };
  const n = rows.length;
  return { tone: worst(rows.map((r) => r.tone)), headline: `KUBO · ${n} ${n === 1 ? 'problema' : 'problemas'}${tail}`, time, rows, expanded: true };
}
