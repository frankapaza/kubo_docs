import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { AgentView, availabilityApi, MonitorServer } from '../../api/availability.api';
import { clientsApi } from '../../api/clients.api';
import { inputStyle } from './availability-ui';
import { agentStatus, fmtLima, isDiskLow, sparkPoints } from './report-format';

const card: React.CSSProperties = { border: '1px solid #e6e9ea', borderRadius: 10, padding: 14, background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 };
const sub: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#6d7577', textTransform: 'uppercase', letterSpacing: 0.4 };

export default function AvailabilityServersPage() {
  const [params] = useSearchParams();
  const highlightId = Number(params.get('serverId')) || null;
  const [clientId, setClientId] = useState<number | ''>('');

  const clients = useQuery({ queryKey: ['availability', 'clients'], queryFn: () => clientsApi.list(), staleTime: 5 * 60_000 });
  const servers = useQuery({ queryKey: ['availability', 'servers'], queryFn: availabilityApi.listServers, refetchInterval: 60_000 });
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.razonSocial])), [clients.data]);

  const visible = (servers.data ?? []).filter((s) => s.status !== 'ARCHIVED' && (clientId === '' || s.clientId === clientId));
  const views = useQueries({
    queries: visible.map((s) => ({
      queryKey: ['availability', 'agent', s.id],
      queryFn: () => availabilityApi.agentView(s.id),
      refetchInterval: 60_000,
    })),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="text-xl font-semibold text-slate-900">Servidores</h1>
      <select aria-label="Cliente" value={clientId} onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : '')} style={{ ...inputStyle, width: 'auto', alignSelf: 'flex-start' }}>
        <option value="">Todos los clientes</option>
        {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
      </select>

      {servers.isLoading && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
      {servers.error && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudieron cargar los servidores.</div>}
      {servers.data && visible.length === 0 && <div style={{ fontSize: 13, color: '#6d7577' }}>No hay servidores. Se cargan en «Inventario».</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
        {visible.map((s, n) => (
          <ServerCard
            key={s.id}
            server={s}
            clientLabel={clientName.get(s.clientId) ?? ''}
            view={views[n]?.data}
            loading={views[n]?.isLoading ?? false}
            failed={views[n]?.isError ?? false}
            highlighted={s.id === highlightId}
          />
        ))}
      </div>
    </div>
  );
}

function ServerCard({ server, clientLabel, view, loading, failed, highlighted }: {
  server: MonitorServer; clientLabel: string; view: AgentView | undefined; loading: boolean; failed: boolean; highlighted: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center' });
  }, [highlighted]);

  const last = view?.lastSampleAt ?? server.agentLastSeenAt;
  const st = agentStatus(server.agentTokenCreatedAt !== null, view?.lastSampleAt ?? null, Date.now());
  const chip =
    st.kind === 'reporting' ? { t: 'Reportando', bg: '#e6f4ea', fg: '#1e7a3c' }
    : st.kind === 'silent' ? { t: `Sin datos desde ${fmtLima(st.since || last)}`, bg: '#fdecea', fg: '#b3261e' }
    : { t: 'Sin agente', bg: '#eef0f1', fg: '#6d7577' };

  return (
    <section ref={ref} id={`server-${server.id}`} style={{ ...card, ...(highlighted ? { borderColor: '#2563eb', boxShadow: '0 0 0 2px #bfdbfe' } : null) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div>
          <Link to={`/monitoreo/servidores/${server.id}`} title='Ver historial de CPU, RAM y errores' style={{ fontWeight: 700, fontSize: 15, color: 'inherit', textDecoration: 'underline', textDecorationColor: '#c4c9cb', textUnderlineOffset: 3 }}>{server.name}</Link>
          <div style={{ fontSize: 12, color: '#6d7577' }}>{clientLabel}{server.host ? ` · ${server.host}` : ''}</div>
        </div>
        <span style={{ background: chip.bg, color: chip.fg, borderRadius: 4, padding: '2px 7px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{chip.t}</span>
      </div>

      {loading && <div style={{ fontSize: 12, color: '#6d7577' }}>Cargando…</div>}
      {failed && !view && <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>No se pudo cargar el estado del agente.</div>}

      {view && view.lastSampleAt && (
        <>
          <div style={{ display: 'flex', gap: 18 }}>
            <Metric label="CPU" value={view.cpuPct} />
            <Metric label="RAM" value={view.ramPct} />
            <div>
              <div style={sub}>Errores del Visor (24 h)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: view.eventErrors24h > 0 ? '#a35c00' : undefined }}>{view.eventErrors24h}</div>
            </div>
          </div>

          <Spark series={view.series24h} />

          <div>
            <div style={sub}>Discos</div>
            {view.disks.length === 0 ? <div style={{ fontSize: 12, color: '#6d7577' }}>Sin discos reportados.</div> : view.disks.map((d) => {
              const low = isDiskLow(d.freePct);
              const pct = d.freePct ?? 0;
              return (
                <div key={d.name} style={{ marginTop: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{d.name}</span>
                    <span style={{ color: low ? '#a35c00' : '#6d7577', fontWeight: low ? 600 : 400 }}>
                      {d.freePct === null ? '—' : `${d.freePct} % libre`}{d.daysToFull !== null ? ` · ≈ ${Math.round(d.daysToFull)} días para llenarse` : ''}
                    </span>
                  </div>
                  <div role="img" aria-label={`${d.name}: ${pct} % libre`} style={{ height: 6, borderRadius: 3, background: '#eef0f1', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: low ? '#e69500' : '#2e9e5b' }} />
                  </div>
                </div>
              );
            })}
          </div>

          {view.iisPools && (
            <div>
              <div style={sub}>Grupos de IIS</div>
              <Chips items={view.iisPools.map((p) => ({ name: p.name, ok: p.state === 'Started', text: p.state }))} />
            </div>
          )}

          <div>
            <div style={sub}>Servicios vigilados</div>
            {view.services.length === 0
              ? <div style={{ fontSize: 12, color: '#6d7577' }}>Ninguno. Se eligen en «Inventario».</div>
              : <Chips items={view.services.map((p) => ({ name: p.name, ok: p.status === 'Running', text: p.status }))} />}
          </div>
        </>
      )}

      {view && !view.lastSampleAt && !loading && (
        <div style={{ fontSize: 12, color: '#6d7577' }}>
          {st.kind === 'none' ? 'Este servidor no tiene agente. Se instala desde «Sondas» → «Agentes».' : 'El agente aún no envió ninguna muestra.'}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div style={sub}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value === null ? '—' : `${Math.round(value)} %`}</div>
    </div>
  );
}

function Chips({ items }: { items: Array<{ name: string; ok: boolean; text: string }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
      {items.map((i) => (
        <span key={i.name} style={{ fontSize: 12, borderRadius: 4, padding: '2px 7px', background: i.ok ? '#e6f4ea' : '#fdecea', color: i.ok ? '#1e7a3c' : '#b3261e' }}>
          {i.name} · {i.text}
        </span>
      ))}
    </div>
  );
}

/** Minigráfica de CPU y RAM de las últimas 24 h, en SVG puro. */
function Spark({ series }: { series: AgentView['series24h'] }) {
  if (series.length < 2) return <div style={{ fontSize: 12, color: '#6d7577' }}>Aún no hay suficientes muestras para la gráfica de 24 h.</div>;
  const w = 340;
  const h = 56;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="CPU y RAM en 24 horas" style={{ background: '#f7f8f8', borderRadius: 6 }}>
        <polyline fill="none" stroke="#2563eb" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={sparkPoints(series.map((p) => p.cpuPct), w, h)} />
        <polyline fill="none" stroke="#9333ea" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={sparkPoints(series.map((p) => p.ramPct), w, h)} />
      </svg>
      <div style={{ fontSize: 11, color: '#6d7577', display: 'flex', gap: 12 }}>
        <span style={{ color: '#2563eb' }}>— CPU</span><span style={{ color: '#9333ea' }}>— RAM</span><span>últimas 24 h</span>
      </div>
    </div>
  );
}
