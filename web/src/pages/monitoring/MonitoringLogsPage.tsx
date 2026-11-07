import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { clientsApi } from '../../api/clients.api';
import { LogSearchParams, monitoringApi } from '../../api/monitoring.api';
import { emitRealtime, LogsLinesEvent, useRealtime, useRealtimeConnect } from '../../lib/realtime';
import LogLineRow, { LogRowData } from './LogLineRow';
import MonitoringFilters, {
  filtersFromParams,
  filtersToParams,
  MonitoringFilterField,
  MonitoringFilterValue,
} from './MonitoringFilters';

const PAGE_LIMIT = 200;
const MAX_LIVE = 1000;
const DEFAULT_RANGE_MS = 60 * 60 * 1000;
/** Margen en píxeles bajo el cual se considera que la persona sigue arriba. */
const TOP_EPSILON = 24;

const btn: React.CSSProperties = {
  fontSize: 12, padding: '6px 10px', border: '1px solid #dfe3e4', borderRadius: 6,
  background: '#fff', cursor: 'pointer', color: '#3a4041', fontFamily: 'inherit',
};

export default function MonitoringLogsPage() {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const filtersKey = JSON.stringify(filters);

  // «La última hora» se ancla al montar, al cambiar filtros o al pulsar
  // Actualizar: si dependiera de `Date.now()` en cada render, la consulta
  // cambiaría de clave constantemente.
  const [anchor, setAnchor] = useState(() => Date.now());
  useEffect(() => setAnchor(Date.now()), [filtersKey]);

  const apiParams: LogSearchParams = useMemo(() => {
    const f = JSON.parse(filtersKey) as MonitoringFilterValue;
    const defaultDesde = !f.desde && !f.hasta ? new Date(anchor - DEFAULT_RANGE_MS).toISOString() : undefined;
    return {
      instalacionId: f.instalacionId,
      cliente: f.cliente,
      sistemaId: f.sistemaId,
      aplicativo: f.aplicativo,
      servidor: f.servidor,
      nivel: f.nivel,
      q: f.q,
      desde: f.desde ?? defaultDesde,
      hasta: f.hasta,
      limit: PAGE_LIMIT,
    };
  }, [filtersKey, anchor]);

  const [live, setLive] = useState(false);

  const search = useInfiniteQuery({
    queryKey: ['monitoring-logs', apiParams],
    queryFn: ({ pageParam }) => monitoringApi.searchLogs({ ...apiParams, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !live,
  });

  const searchRows: LogRowData[] = useMemo(
    () =>
      (search.data?.pages ?? []).flatMap((p) =>
        p.lines.map((l) => ({
          key: l.id, ts: l.ts, nivel: l.nivel, clienteId: l.clienteId, aplicativo: l.aplicativo, servidor: l.servidor,
          logger: l.logger, mensaje: l.mensaje, excepcion: l.excepcion, hilo: l.hilo, propiedades: l.propiedades,
        })),
      ),
    [search.data],
  );

  // ------------------------------------------------------------------ en vivo
  const [liveRows, setLiveRows] = useState<LogRowData[]>([]);
  const [omitidas, setOmitidas] = useState(0);
  const [pending, setPending] = useState(0);
  const pendingRef = useRef<LogRowData[]>([]);
  const pausedRef = useRef(false);
  const seq = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  /** Filtro del socket: allí el nivel es `nivelMinimo` y el texto es `texto`. */
  const livePayload = useMemo(() => {
    const f = JSON.parse(filtersKey) as MonitoringFilterValue;
    return {
      instalacionId: f.instalacionId,
      cliente: f.cliente,
      sistemaId: f.sistemaId,
      aplicativo: f.aplicativo,
      servidor: f.servidor,
      nivelMinimo: f.nivel,
      texto: f.q,
    };
  }, [filtersKey]);

  // Memoizado: useRealtimeConnect se reengancha cada vez que cambia el handler
  // y, con el socket conectado, lo llama al instante. Eso cubre la
  // reconexión (socket.io pierde la sala) y el cambio de filtros con el vivo
  // encendido.
  const subscribe = useCallback(() => {
    if (live) emitRealtime('logs:subscribe', livePayload);
  }, [live, livePayload]);
  useRealtimeConnect(subscribe);

  useEffect(() => {
    if (!live) return;
    return () => emitRealtime('logs:unsubscribe');
  }, [live]);

  // Lo que se veía deja de valer al encender, apagar o cambiar de filtro.
  useEffect(() => {
    setLiveRows([]);
    setOmitidas(0);
    setPending(0);
    pendingRef.current = [];
  }, [live, filtersKey]);

  const onLines = useCallback((ev: LogsLinesEvent) => {
    if (ev.omitidas > 0) setOmitidas((n) => n + ev.omitidas);
    // Más nueva primero; el lote llega en orden cronológico.
    const incoming: LogRowData[] = ev.lines
      .map((l) => ({
        key: `live-${++seq.current}`, ts: l.ts, nivel: l.nivel, clienteId: l.clienteId, aplicativo: l.aplicativo, servidor: l.servidor,
        logger: l.logger, mensaje: l.mensaje, excepcion: l.excepcion, hilo: l.hilo,
      }))
      .reverse();
    if (incoming.length === 0) return;
    if (pausedRef.current) {
      pendingRef.current = [...incoming, ...pendingRef.current].slice(0, MAX_LIVE);
      setPending(pendingRef.current.length);
    } else {
      setLiveRows((prev) => [...incoming, ...prev].slice(0, MAX_LIVE));
    }
  }, []);
  useRealtime('logs:lines', onLines);

  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const add = pendingRef.current;
    pendingRef.current = [];
    setPending(0);
    setLiveRows((prev) => [...add, ...prev].slice(0, MAX_LIVE));
  }, []);

  const onScroll = () => {
    const atTop = (scroller.current?.scrollTop ?? 0) <= TOP_EPSILON;
    pausedRef.current = !atTop;
    if (atTop) flushPending();
  };

  const changeFilters = (next: MonitoringFilterValue) => setParams(filtersToParams(next, params), { replace: true });

  // Misma clave que MonitoringFilters: la caché ya lo trae. `displayName` de
  // una instalación de cliente es «Cliente · Sistema», así que el nombre sale
  // del catálogo de clientes.
  const clients = useQuery({ queryKey: ['monitoring-filter-clients'], queryFn: () => clientsApi.list(), staleTime: 60_000 });
  const clientNames = useMemo(() => new Map((clients.data ?? []).map((c) => [Number(c.id), c.razonSocial])), [clients.data]);
  const clienteNombre = (id: number | null): string => (id === null ? 'Interno' : clientNames.get(id) ?? `Cliente ${id}`);

  const rows = live ? liveRows : searchRows;
  const failed = !live && search.isError;
  const fields: MonitoringFilterField[] = ['cliente', 'sistema', 'aplicativo', 'servidor', 'nivel', 'texto'];
  if (!live) fields.splice(5, 0, 'rango');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 className="text-xl font-semibold text-slate-900" style={{ flex: 1 }}>Logs</h1>
        {!live && (
          <button type="button" onClick={() => { setAnchor(Date.now()); search.refetch(); }} style={btn}>
            Actualizar
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          En vivo
          {live && <span style={{ width: 8, height: 8, borderRadius: 4, background: '#1e7a3c' }} />}
        </label>
      </div>

      <MonitoringFilters value={filters} onChange={changeFilters} show={fields} />
      {!live && !filters.desde && !filters.hasta && (
        <div style={{ fontSize: 11, color: '#6d7577' }}>Mostrando la última hora. Elige un rango para ver otra.</div>
      )}
      {live && (
        <div style={{ fontSize: 11, color: '#6d7577' }}>
          En vivo: solo llegan líneas nuevas que cumplan los filtros (se conservan las {MAX_LIVE} últimas).
        </div>
      )}
      {live && omitidas > 0 && (
        <div style={{ fontSize: 12, color: '#a35c00' }}>{omitidas} líneas omitidas (siguen en la búsqueda)</div>
      )}
      {live && pending > 0 && (
        <button
          type="button"
          onClick={() => { scroller.current?.scrollTo({ top: 0 }); pausedRef.current = false; flushPending(); }}
          style={btn}
        >
          {pending} líneas nuevas · volver arriba
        </button>
      )}

      <div
        ref={scroller}
        onScroll={onScroll}
        style={{ border: '1px solid #dfe3e4', borderRadius: 8, background: '#fff', maxHeight: '70vh', overflow: 'auto' }}
      >
        {failed && <div style={{ padding: 16, color: '#b3261e', fontSize: 13 }}>No se pudieron cargar los logs.</div>}
        {!live && search.isLoading && <div style={{ padding: 16, fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
        {rows.map((r) => <LogLineRow key={r.key} line={r} clienteNombre={clienteNombre(r.clienteId)} />)}
        {!failed && !(!live && search.isLoading) && rows.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: '#6d7577' }}>
            {live ? 'Esperando líneas nuevas…' : 'No hay logs para estos filtros.'}
          </div>
        )}
        {!live && search.hasNextPage && (
          <div style={{ padding: 10, textAlign: 'center' }}>
            <button type="button" disabled={search.isFetchingNextPage} onClick={() => search.fetchNextPage()} style={btn}>
              {search.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
