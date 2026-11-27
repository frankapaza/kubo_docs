import type { CheckRow, CombinedStatus, Criticality, IncidentKind, ProbeSide, Protocol } from '../../api/availability.api';

export const STATUS_LABELS: Record<CombinedStatus, string> = {
  OK: 'Operativo',
  VERIFYING: 'Verificando',
  DEGRADED: 'Degradado',
  DOWN: 'Caído',
  ROUTE: 'Sin acceso desde Perú',
  NO_DATA: 'Sin datos',
};

/** Rojo DOWN/ROUTE, ámbar VERIFYING/DEGRADED, gris NO_DATA, verde OK. */
export const STATUS_COLORS: Record<CombinedStatus, { bg: string; fg: string }> = {
  OK: { bg: '#e6f4ea', fg: '#1e7a3c' },
  VERIFYING: { bg: '#fff4e0', fg: '#a35c00' },
  DEGRADED: { bg: '#fff4e0', fg: '#a35c00' },
  DOWN: { bg: '#fdecea', fg: '#b3261e' },
  ROUTE: { bg: '#fdecea', fg: '#b3261e' },
  NO_DATA: { bg: '#eef0f1', fg: '#6d7577' },
};

export const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as CombinedStatus[];

export const INCIDENT_KIND_LABELS: Record<IncidentKind, string> = {
  DOWN: STATUS_LABELS.DOWN,
  ROUTE: STATUS_LABELS.ROUTE,
  DEGRADED: STATUS_LABELS.DEGRADED,
};

export const CRITICALITY_LABELS: Record<Criticality, string> = { HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja' };
export const PROTOCOL_OPTIONS: Protocol[] = ['TCP', 'HTTPS', 'ICMP'];

export const EVENT_LABELS: Record<string, string> = {
  OPENED: 'Incidente abierto',
  REOPENED: 'Incidente reabierto',
  UPGRADED_TO_DOWN: 'Escala a caído',
  RECOVERED: 'Recuperado',
  ACKNOWLEDGED: 'Reconocido',
  NOTE: 'Nota',
};

export const fmtDateTime = (v: string | null | undefined): string => (v ? new Date(v).toLocaleString('es-PE') : '—');

export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const PROBE_STATE_LABELS: Record<string, string> = { OK: 'OK', VERIFYING: 'Verificando', FAILED: 'Falla', DEGRADED: 'Lento' };

export function fmtProbeSide(p: ProbeSide | null): string {
  if (!p) return 'Sin datos';
  const base = PROBE_STATE_LABELS[p.state] ?? p.state;
  return p.lastLatencyMs === null ? base : `${base} · ${p.lastLatencyMs} ms`;
}

export function fmtCheck(c: CheckRow): string {
  const when = new Date(c.startedAt).toLocaleTimeString('es-PE');
  if (c.ok) return `${when} · OK · ${c.durationMs} ms`;
  return `${when} · ${c.errorCode ?? 'Falla'}${c.httpStatus ? ` ${c.httpStatus}` : ''} · ${c.durationMs} ms`;
}

type ApiError = { response?: { status?: number; data?: { message?: string } } };
export const apiMessage = (e: unknown, fallback: string): string => (e as ApiError).response?.data?.message ?? fallback;
export const apiStatus = (e: unknown): number | undefined => (e as ApiError).response?.status;

export const btn: React.CSSProperties = { fontSize: 12, padding: '6px 10px', borderRadius: 6, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' };
export const btnPrimary: React.CSSProperties = { fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer' };
export const inputStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6,
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
export const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 5, display: 'block' };
export const tableWrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid #e6e9ea', borderRadius: 8 };
export const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
export const td: React.CSSProperties = { padding: '8px 10px' };
