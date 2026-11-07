import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { clientsApi } from '../../api/clients.api';
import {
  ErrorGroupStatus,
  LOG_LEVELS,
  LogLevel,
  monitoringApi,
} from '../../api/monitoring.api';
import { systemsApi } from '../../api/tickets.api';
import { ERROR_STATUS_LABELS } from './monitoring-ui';

/**
 * Filtros comunes de Errores y Logs. Viven en la URL (ver `filtersFromParams`
 * y `filtersToParams`) para que «ver logs», el enlace del ticket y recargar la
 * página reproduzcan la misma vista.
 */
export interface MonitoringFilterValue {
  /** Id de cliente o `interno`. */
  cliente?: string;
  sistemaId?: number;
  aplicativo?: string;
  servidor?: string;
  status?: ErrorGroupStatus;
  nivel?: LogLevel;
  /** ISO 8601 (o `YYYY-MM-DD` si viene de un enlace). */
  desde?: string;
  hasta?: string;
  q?: string;
  instalacionId?: number;
}

export type MonitoringFilterField =
  | 'cliente'
  | 'sistema'
  | 'aplicativo'
  | 'servidor'
  | 'estado'
  | 'nivel'
  | 'rango'
  | 'texto';

interface Props {
  value: MonitoringFilterValue;
  onChange: (next: MonitoringFilterValue) => void;
  show: MonitoringFilterField[];
}

const STATUSES: ErrorGroupStatus[] = ['NUEVO', 'CON_TICKET', 'RESUELTO'];
const SEARCH_DEBOUNCE_MS = 280;

const num = (v: string | null): number | undefined => {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function filtersFromParams(p: URLSearchParams): MonitoringFilterValue {
  const status = p.get('status');
  const nivel = p.get('nivel');
  return {
    cliente: p.get('cliente') || undefined,
    sistemaId: num(p.get('sistemaId')),
    aplicativo: p.get('aplicativo') || undefined,
    servidor: p.get('servidor') || undefined,
    status: STATUSES.includes(status as ErrorGroupStatus) ? (status as ErrorGroupStatus) : undefined,
    nivel: LOG_LEVELS.includes(nivel as LogLevel) ? (nivel as LogLevel) : undefined,
    desde: p.get('desde') || undefined,
    hasta: p.get('hasta') || undefined,
    q: p.get('q') || undefined,
    instalacionId: num(p.get('instalacionId')),
  };
}

/** Vuelca los filtros sobre unos parámetros existentes sin tocar los que no son de filtro. */
export function filtersToParams(v: MonitoringFilterValue, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  const keys: Array<keyof MonitoringFilterValue> = [
    'cliente', 'sistemaId', 'aplicativo', 'servidor', 'status', 'nivel', 'desde', 'hasta', 'q', 'instalacionId',
  ];
  for (const k of keys) {
    const x = v[k];
    if (x === undefined || x === '') p.delete(k);
    else p.set(k, String(x));
  }
  return p;
}

/** `datetime-local` pide hora local sin zona; el estado guarda ISO. */
function isoToLocalInput(v: string | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const controlStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid #dfe3e4',
  borderRadius: 6,
  background: '#fff',
  fontFamily: 'inherit',
  minWidth: 0,
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 11,
  fontWeight: 600,
  color: '#6d7577',
};

export default function MonitoringFilters({ value, onChange, show }: Props) {
  const has = (f: MonitoringFilterField) => show.includes(f);

  const clients = useQuery({
    queryKey: ['monitoring-filter-clients'],
    queryFn: () => clientsApi.list(),
    enabled: has('cliente'),
    staleTime: 60_000,
  });
  const systems = useQuery({
    queryKey: ['monitoring-filter-systems'],
    queryFn: () => systemsApi.list(),
    enabled: has('sistema'),
    staleTime: 60_000,
  });
  const sources = useQuery({
    queryKey: ['monitoring-sources'],
    queryFn: () => monitoringApi.sources(),
    enabled: has('aplicativo') || has('servidor'),
    staleTime: 60_000,
  });

  // El texto se escribe en local y sube a la URL con retardo: sin esto cada
  // tecla sería una consulta (y una entrada en el historial).
  const [qInput, setQInput] = useState(value.q ?? '');
  useEffect(() => setQInput(value.q ?? ''), [value.q]);
  useEffect(() => {
    if (qInput.trim() === (value.q ?? '')) return;
    const t = setTimeout(() => onChange({ ...value, q: qInput.trim() || undefined }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const set = (patch: Partial<MonitoringFilterValue>) => onChange({ ...value, ...patch });
  const dirty = Object.values(value).some((x) => x !== undefined);

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {has('cliente') && (
        <label style={labelStyle}>
          Cliente
          <select
            value={value.cliente ?? ''}
            onChange={(e) => set({ cliente: e.target.value || undefined })}
            style={controlStyle}
          >
            <option value="">Todos</option>
            <option value="interno">Sin cliente (interno)</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>{c.razonSocial}</option>
            ))}
          </select>
        </label>
      )}
      {has('sistema') && (
        <label style={labelStyle}>
          Sistema
          <select
            value={value.sistemaId ?? ''}
            onChange={(e) => set({ sistemaId: num(e.target.value) })}
            style={controlStyle}
          >
            <option value="">Todos</option>
            {(systems.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      )}
      {has('aplicativo') && (
        <label style={labelStyle}>
          Aplicativo
          <select
            value={value.aplicativo ?? ''}
            onChange={(e) => set({ aplicativo: e.target.value || undefined })}
            style={controlStyle}
          >
            <option value="">Todos</option>
            {value.aplicativo && !sources.data?.aplicativos.includes(value.aplicativo) && (
              <option value={value.aplicativo}>{value.aplicativo}</option>
            )}
            {(sources.data?.aplicativos ?? []).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
      )}
      {has('servidor') && (
        <label style={labelStyle}>
          Servidor
          <select
            value={value.servidor ?? ''}
            onChange={(e) => set({ servidor: e.target.value || undefined })}
            style={controlStyle}
          >
            <option value="">Todos</option>
            {value.servidor && !sources.data?.servidores.includes(value.servidor) && (
              <option value={value.servidor}>{value.servidor}</option>
            )}
            {(sources.data?.servidores ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {has('estado') && (
        <label style={labelStyle}>
          Estado
          <select
            value={value.status ?? ''}
            onChange={(e) => set({ status: (e.target.value || undefined) as ErrorGroupStatus | undefined })}
            style={controlStyle}
          >
            <option value="">Todos</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{ERROR_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
      )}
      {has('nivel') && (
        <label style={labelStyle}>
          Nivel mínimo
          <select
            value={value.nivel ?? ''}
            onChange={(e) => set({ nivel: (e.target.value || undefined) as LogLevel | undefined })}
            style={controlStyle}
          >
            <option value="">Todos</option>
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
      )}
      {has('rango') && (
        <>
          <label style={labelStyle}>
            Desde
            <input
              type="datetime-local"
              value={isoToLocalInput(value.desde)}
              onChange={(e) => set({ desde: localInputToIso(e.target.value) })}
              style={controlStyle}
            />
          </label>
          <label style={labelStyle}>
            Hasta
            <input
              type="datetime-local"
              value={isoToLocalInput(value.hasta)}
              onChange={(e) => set({ hasta: localInputToIso(e.target.value) })}
              style={controlStyle}
            />
          </label>
        </>
      )}
      {has('texto') && (
        <label style={{ ...labelStyle, flex: '1 1 180px' }}>
          Texto
          <input
            type="search"
            value={qInput}
            placeholder="Buscar…"
            onChange={(e) => setQInput(e.target.value)}
            style={controlStyle}
          />
        </label>
      )}
      {dirty && (
        <button
          type="button"
          onClick={() => onChange({})}
          style={{ ...controlStyle, cursor: 'pointer', color: '#3a4041' }}
        >
          Limpiar
        </button>
      )}
    </div>
  );
}
