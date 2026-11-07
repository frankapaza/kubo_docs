import type { ErrorGroupStatus, LogLevel } from '../../api/monitoring.api';

export const ERROR_STATUS_LABELS: Record<ErrorGroupStatus, string> = {
  NUEVO: 'Nuevo',
  CON_TICKET: 'Con ticket',
  RESUELTO: 'Resuelto',
};

export const ERROR_STATUS_STYLES: Record<ErrorGroupStatus, { bg: string; fg: string }> = {
  NUEVO: { bg: '#fdecea', fg: '#b3261e' },
  CON_TICKET: { bg: '#e8f0fe', fg: '#1a56c4' },
  RESUELTO: { bg: '#e6f4ea', fg: '#1e7a3c' },
};

export const LEVEL_STYLES: Record<LogLevel, { bg: string; fg: string }> = {
  DEBUG: { bg: '#eef0f1', fg: '#6d7577' },
  INFO: { bg: '#e8f0fe', fg: '#1a56c4' },
  WARN: { bg: '#fff4e0', fg: '#a35c00' },
  ERROR: { bg: '#fdecea', fg: '#b3261e' },
  FATAL: { bg: '#b3261e', fg: '#ffffff' },
};

/** Fecha y hora local legibles; `—` si no hay. */
export function fmtDateTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString('es-PE') : '—';
}
