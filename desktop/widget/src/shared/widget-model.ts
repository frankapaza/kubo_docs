import type { CombinedStateRow, EngineStatus, ProbeView } from './types';

export type Tone = 'ok' | 'red' | 'amber' | 'grey';

export interface WidgetRow {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  incidentId: number | null;
  children: WidgetRow[];
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
  const extra: WidgetRow[] = [];
  if (!status.central.reachable) {
    extra.push({ key: 'central', tone: 'amber', title: 'La central no responde', detail: '', incidentId: null, children: [] });
  } else if (status.central.rejecting) {
    extra.push({ key: 'central', tone: 'amber', title: 'La central rechaza los envíos', detail: '', incidentId: null, children: [] });
  }
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
  if (rows.length === 0) return { tone: 'ok', headline: 'KUBO · Todo operativo', time, rows, expanded: false };
  const n = rows.length;
  return { tone: worst(rows.map((r) => r.tone)), headline: `KUBO · ${n} ${n === 1 ? 'problema' : 'problemas'}`, time, rows, expanded: true };
}
