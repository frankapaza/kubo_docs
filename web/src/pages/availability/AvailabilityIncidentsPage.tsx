import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { availabilityApi, IncidentRow } from '../../api/availability.api';
import { fmtDateTime, fmtDuration, INCIDENT_KIND_LABELS, STATUS_COLORS, tableWrap, td, th } from './availability-ui';

type Tab = 'open' | 'closed';

export default function AvailabilityIncidentsPage() {
  const [tab, setTab] = useState<Tab>('open');
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const navigate = useNavigate();

  const list = useQuery({
    queryKey: ['availability', 'incidents', tab],
    queryFn: () => availabilityApi.listIncidents({ open: tab === 'open' }),
    refetchInterval: 30_000,
  });

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const items = list.data?.items ?? [];
// Un hijo se agrupa bajo su padre por parentId; si el padre no está en la lista (otra pestaña o recorte), va suelto.  const ids = new Set(items.map((i) => i.id));  const topLevel = items.filter((i) => i.parentId === null || !ids.has(i.parentId));

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      style={{
        fontSize: 13, fontWeight: 600, padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
        borderBottom: tab === t ? '2px solid #15191a' : '2px solid transparent', color: tab === t ? '#15191a' : '#6d7577',
      }}
    >
      {label}
    </button>
  );

  const row = (i: IncidentRow, child: boolean) => {
    const c = STATUS_COLORS[i.kind];
    return (
      <tr
        key={i.id}
        onClick={() => navigate(`/monitoreo/incidentes/${i.id}`)}
        style={{ borderTop: '1px solid #eef0f1', cursor: 'pointer', background: child ? '#fafbfb' : undefined }}
      >
        <td style={{ ...td, paddingLeft: child ? 30 : 10 }}>
          {!child && i.childCount > 0 && (
            <button
              type="button"
              aria-label={expanded.has(i.id) ? 'Ocultar servicios' : 'Ver servicios'}
              onClick={(e) => { e.stopPropagation(); toggle(i.id); }}
              style={{ border: 'none', background: 'none', cursor: 'pointer', marginRight: 4 }}
            >
              {expanded.has(i.id) ? '▾' : '▸'}
            </button>
          )}
          <span style={{ fontWeight: 600 }}>
            {i.serviceName ?? `Servidor ${i.serverName}`}
          </span>
          {!child && i.childCount > 0 && <span style={{ color: '#6d7577' }}> · {i.childCount} servicios</span>}
        </td>
        <td style={td}>{i.serverName}</td>
        <td style={td}>{i.clientName}</td>
        <td style={td}>
          <span style={{ background: c.bg, color: c.fg, borderRadius: 4, padding: '2px 7px', fontSize: 12, fontWeight: 600 }}>
            {INCIDENT_KIND_LABELS[i.kind]}
          </span>
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDateTime(i.firstFailureAt)}</td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDuration(i.durationMinutes)}</td>
        <td style={td}>{i.ticketCode ?? '—'}</td>
      </tr>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="text-xl font-semibold text-slate-900">Incidentes</h1>
      <div style={{ display: 'flex', borderBottom: '1px solid #e6e9ea' }}>
        {tabBtn('open', 'Abiertos')}
        {tabBtn('closed', 'Cerrados')}
      </div>

      {list.isLoading && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
      {list.error && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudieron cargar los incidentes.</div>}
      {list.data?.truncated && (
        <div style={{ fontSize: 12, color: '#a35c00' }}>Hay más incidentes de los que se muestran: se ven los más recientes.</div>
      )}

      {list.data && (
        items.length === 0 ? (
          <div style={{ fontSize: 13, color: '#6d7577' }}>{tab === 'open' ? 'No hay incidentes abiertos.' : 'No hay incidentes cerrados.'}</div>
        ) : (
          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', background: '#f7f8f8', color: '#6d7577', fontSize: 12 }}>
                  {['Incidente', 'Servidor', 'Cliente', 'Tipo', 'Desde', 'Duración', 'Ticket'].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {topLevel.flatMap((i) => [
                  row(i, false),
                  ...(expanded.has(i.id) ? [<ChildRows key={`children-${i.id}`} parentId={i.id} render={(k) => row(k, true)} />] : []),
                ])}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

/** Los servicios de un incidente de servidor, del detalle: incluye los ya recuperados, así cuadran con childCount. */
function ChildRows({ parentId, render }: { parentId: number; render: (k: IncidentRow) => JSX.Element }) {
  const detail = useQuery({
    queryKey: ['availability', 'incident', parentId],
    queryFn: () => availabilityApi.incidentDetail(parentId),
  });
  if (detail.isLoading) {
    return <tr><td colSpan={7} style={{ ...td, paddingLeft: 30, color: '#6d7577' }}>Cargando servicios…</td></tr>;
  }
  if (detail.error || !detail.data) {
    return <tr><td colSpan={7} style={{ ...td, paddingLeft: 30, color: '#b3261e' }}>No se pudieron cargar los servicios.</td></tr>;
  }
  return <>{detail.data.children.map(render)}</>;
}
