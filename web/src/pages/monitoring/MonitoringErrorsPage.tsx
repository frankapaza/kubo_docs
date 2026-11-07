import { useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';

import { ErrorListParams, monitoringApi } from '../../api/monitoring.api';
import { useRealtime } from '../../lib/realtime';
import MonitoringFilters, { filtersFromParams, filtersToParams, MonitoringFilterValue } from './MonitoringFilters';
import { ERROR_STATUS_LABELS, ERROR_STATUS_STYLES, fmtDateTime } from './monitoring-ui';

const PAGE_SIZE = 25;
const GRID = '96px minmax(220px, 1fr) 190px 130px 90px 150px 100px';

type Orden = 'ultima' | 'cantidad';

export default function MonitoringErrorsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const filters = filtersFromParams(params);
  const orden: Orden = params.get('orden') === 'cantidad' ? 'cantidad' : 'ultima';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const apiParams: ErrorListParams = {
    cliente: filters.cliente,
    sistemaId: filters.sistemaId,
    aplicativo: filters.aplicativo,
    servidor: filters.servidor,
    status: filters.status,
    desde: filters.desde,
    hasta: filters.hasta,
    q: filters.q,
    orden,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['monitoring-errors', apiParams],
    queryFn: () => monitoringApi.listErrors(apiParams),
    placeholderData: keepPreviousData,
  });

  // Un error nuevo, resuelto o con ticket cambia la lista: se recarga la vista
  // actual en vez de intentar parchearla.
  const onChanged = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['monitoring-errors'] });
  }, [queryClient]);
  useRealtime('errors:changed', onChanged);

  const changeFilters = (next: MonitoringFilterValue) => {
    const p = filtersToParams(next, params);
    p.delete('page');
    setParams(p, { replace: true });
  };
  const setOrden = (o: Orden) => {
    const p = new URLSearchParams(params);
    if (o === 'ultima') p.delete('orden');
    else p.set('orden', o);
    p.delete('page');
    setParams(p, { replace: true });
  };
  const goPage = (n: number) => {
    const p = new URLSearchParams(params);
    if (n <= 1) p.delete('page');
    else p.set('page', String(n));
    setParams(p);
  };

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];

  return (
    <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Errores</h1>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6d7577' }}>
          Ordenar por
          <select
            value={orden}
            onChange={(e) => setOrden(e.target.value as Orden)}
            style={{ fontSize: 12, padding: '6px 8px', border: '1px solid #dfe3e4', borderRadius: 6, background: '#fff' }}
          >
            <option value="ultima">Última vez</option>
            <option value="cantidad">Cantidad</option>
          </select>
        </label>
      </div>

      <section style={{ background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid #eceeef' }}>
          <MonitoringFilters
            value={filters}
            onChange={changeFilters}
            show={['cliente', 'sistema', 'aplicativo', 'servidor', 'estado', 'rango', 'texto']}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 980 }}>
            <div
              style={{
                display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '10px 18px',
                fontSize: 11, fontWeight: 600, color: '#6d7577', borderBottom: '1px solid #eceeef',
              }}
            >
              <span>Estado</span>
              <span>Error</span>
              <span>Cliente · sistema</span>
              <span>Aplicativo</span>
              <span style={{ textAlign: 'right' }}>Ocurr.</span>
              <span>Última vez</span>
              <span>Ticket</span>
            </div>

            {isLoading && <div style={{ padding: 18, fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
            {error && !data && (
              <div role="alert" style={{ padding: 18, fontSize: 13, color: 'oklch(0.5 0.16 25)' }}>
                {(error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                  'No se pudo cargar la lista de errores.'}
              </div>
            )}
            {!isLoading && !error && items.length === 0 && (
              <div style={{ padding: 18, fontSize: 13, color: '#6d7577' }}>No hay errores con estos filtros.</div>
            )}

            {items.map((g) => {
              const st = ERROR_STATUS_STYLES[g.status];
              const ticketId = g.ticket?.id;
              return (
                <Link
                  key={g.id}
                  to={`/monitoreo/errores/${g.id}`}
                  style={{
                    display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '12px 18px',
                    alignItems: 'center', borderBottom: '1px solid #f1f3f3', textDecoration: 'none',
                    color: 'inherit', fontSize: 13,
                  }}
                >
                  <span>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 10, background: st.bg, color: st.fg }}>
                      {ERROR_STATUS_LABELS[g.status]}
                    </span>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.title}>
                      {g.title}
                    </span>
                    {g.reopenedAt && (
                      <span style={{ fontSize: 11, color: '#a35c00' }}>Reabierto{g.reopenReason ? `: ${g.reopenReason}` : ''}</span>
                    )}
                  </span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#3a4041' }}>
                    {g.clientName ?? 'Interno'} · {g.systemName ?? '—'}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#3a4041' }}>
                    {g.aplicativo}
                  </span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {g.occurrencesTotal.toLocaleString('es-PE')}
                  </span>
                  <span style={{ fontSize: 12, color: '#3a4041' }}>{fmtDateTime(g.lastSeenAt)}</span>
                  <span>
                    {g.ticket && ticketId !== undefined ? (
                      // Un `<a>` dentro del `<a>` de la fila no es válido: el enlace al
                      // ticket es un span que navega por su cuenta.
                      <span
                        role="link"
                        tabIndex={0}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigate(`/tickets/${ticketId}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            navigate(`/tickets/${ticketId}`);
                          }
                        }}
                        style={{ fontSize: 12, fontWeight: 600, color: '#0b6e75', cursor: 'pointer' }}
                      >
                        {g.ticket.code}
                      </span>
                    ) : (
                      <span style={{ color: '#9aa1a3' }}>—</span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#6d7577' }}>
          <span>{total.toLocaleString('es-PE')} errores</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" disabled={page <= 1} onClick={() => goPage(page - 1)} style={pagerBtn(page <= 1)}>
              Anterior
            </button>
            <span>Página {page} de {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => goPage(page + 1)} style={pagerBtn(page >= pages)}>
              Siguiente
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}

const pagerBtn = (disabled: boolean): React.CSSProperties => ({
  fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #dfe3e4', background: '#fff',
  color: '#3a4041', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
});
