import { Link } from 'react-router-dom';

import { ProbeSide, StateRow } from '../../api/availability.api';
import { fmtDateTime, STATUS_COLORS, STATUS_LABELS } from './availability-ui';

const INK = '#1f2937';
const MUTED = '#6d7577';
const LINE = '#e6e9ea';
const GOOD = '#1e7a3c';
const WARN = '#a35c00';
const BAD = '#b3261e';

const card: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff' };
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: INK, margin: 0 };
const sectionHint: React.CSSProperties = { fontSize: 12, color: MUTED };

/** Color de una latencia frente al umbral del servicio: verde holgado, ámbar cerca, rojo encima o con falla. */
function latencyTone(p: ProbeSide | null, threshold: number): string {
  if (!p || p.lastLatencyMs === null) return MUTED;
  if (p.state === 'FAILED' || p.state === 'VERIFYING') return BAD;
  if (p.lastLatencyMs > threshold) return BAD;
  if (p.lastLatencyMs > threshold * 0.6) return WARN;
  return GOOD;
}

function Latency({ p, threshold, big = false }: { p: ProbeSide | null; threshold: number; big?: boolean }) {
  if (!p) return <span style={{ fontSize: big ? 13 : 12, color: MUTED }}>Sin datos</span>;
  const failed = p.state === 'FAILED';
  return (
    <span title={p.lastCheckAt ? `Última prueba: ${fmtDateTime(p.lastCheckAt)}` : undefined} style={{ color: latencyTone(p, threshold), fontWeight: 600, fontSize: big ? 22 : 13, fontVariantNumeric: 'tabular-nums' }}>
      {failed ? 'Falla' : p.lastLatencyMs === null ? '—' : `${p.lastLatencyMs} ms`}
    </span>
  );
}

/** Bandera del Perú (rojo-blanco-rojo). SVG y no emoji: en Windows el emoji se ve como «PE». */
function PeFlag() {
  return (
    <svg width="15" height="10" viewBox="0 0 3 2" role="img" aria-label="Perú" style={{ borderRadius: 2, boxShadow: '0 0 0 1px #e3e8ef', flex: 'none' }}>
      <rect width="1" height="2" x="0" fill="#D91023" />
      <rect width="1" height="2" x="1" fill="#ffffff" />
      <rect width="1" height="2" x="2" fill="#D91023" />
    </svg>
  );
}

function StatusPill({ r }: { r: StateRow }) {
  const c = STATUS_COLORS[r.status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: c.bg, color: c.fg, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: c.fg }} />
      {STATUS_LABELS[r.status]}
    </span>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div style={{ ...card, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: tone ?? INK, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{hint}</div>
    </div>
  );
}

export interface StateBoardsProps {
  rows: StateRow[];
  clientName: Map<number, string>;
  cooling: ReadonlySet<number>;
  onCheck: (serviceId: number) => void;
}

/**
 * Pantalla de Estado: resumen arriba, servicios (aplicaciones) y, aparte, el ping de
 * red de cada servidor, que mide la ruta y no la aplicación.
 */
export default function StateBoards({ rows, clientName, cooling, onCheck }: StateBoardsProps) {
  const pings = rows.filter((r) => r.protocol === 'ICMP');
  const services = rows.filter((r) => r.protocol !== 'ICMP');
  // «Sin datos» no es un problema del servicio (p. ej. recién creado): solo caídas, rutas, lentitud o verificación.
  const problems = services.filter((r) => ['DOWN', 'ROUTE', 'DEGRADED', 'VERIFYING'].includes(r.status));
  const officeMs = pings.map((p) => p.office?.lastLatencyMs).filter((v): v is number => typeof v === 'number');
  const avgPing = officeMs.length ? Math.round(officeMs.reduce((a, b) => a + b, 0) / officeMs.length) : null;
  const slowPings = pings.filter((p) => latencyTone(p.office, p.latencyThresholdMs) === BAD).length;
  const openIncidents = rows.filter((r) => r.incidentId !== null).length;

  const checkBtn = (id: number) => (
    <button
      type="button"
      onClick={() => onCheck(id)}
      disabled={cooling.has(id)}
      title="Probar ahora desde las dos sondas"
      style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff', color: INK, cursor: cooling.has(id) ? 'not-allowed' : 'pointer', opacity: cooling.has(id) ? 0.5 : 1, whiteSpace: 'nowrap' }}
    >
      {cooling.has(id) ? 'Probando…' : 'Probar ahora'}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Tile
          label="Servicios"
          value={`${services.length - problems.length} / ${services.length}`}
          hint={problems.length ? `${problems.length} con problemas` : 'Todos operativos'}
          tone={problems.length ? BAD : GOOD}
        />
        <Tile label="Ping promedio desde Perú" value={avgPing === null ? '—' : `${avgPing} ms`} hint={`${pings.length} servidor(es) con ping`} />
        <Tile label="Pings sobre el umbral" value={String(slowPings)} hint={slowPings ? 'Revisa la ruta o el proveedor' : 'Red estable'} tone={slowPings ? BAD : GOOD} />
        <Tile label="Incidentes abiertos" value={String(openIncidents)} hint={openIncidents ? 'Ver en Incidentes' : 'Sin incidentes'} tone={openIncidents ? BAD : INK} />
      </div>

      {services.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={sectionTitle}>Servicios</h2>
            <span style={sectionHint}>Aplicaciones y páginas: responde el sistema completo, no solo la red.</span>
          </div>
          <div style={{ ...card, overflow: 'hidden' }}>
            {services.map((r, i) => (
              <div
                key={r.serviceId}
                style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) repeat(2, minmax(110px, 1fr)) minmax(140px, 1fr) auto', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? `1px solid ${LINE}` : 'none' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: INK, fontSize: 14 }}>{r.serviceName}</div>
                  <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Link to={`/monitoreo/servidores/${r.serverId}`} style={{ color: MUTED }} className="hover:underline">{r.serverName}</Link>
                    {' · '}{clientName.get(r.clientId) ?? '—'} · {r.protocol}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: MUTED, display: 'flex', alignItems: 'center', gap: 5 }}><PeFlag />Desde Perú</div>
                  <Latency p={r.office} threshold={r.latencyThresholdMs} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: MUTED }}>Desde servidor</div>
                  <Latency p={r.datacenter} threshold={r.latencyThresholdMs} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <StatusPill r={r} />
                  {r.maintenance && <span style={{ background: '#e8efff', color: '#1d4ed8', borderRadius: 999, padding: '3px 9px', fontSize: 12, fontWeight: 600 }}>Mantenimiento</span>}
                  {r.incidentId !== null && (
                    <Link to={`/monitoreo/incidentes/${r.incidentId}`} className="text-blue-700 hover:underline" style={{ fontSize: 12 }}>{r.ticketCode ?? 'Incidente'}</Link>
                  )}
                </div>
                {checkBtn(r.serviceId)}
              </div>
            ))}
          </div>
        </section>
      )}

      {pings.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={sectionTitle}>Ping de red</h2>
            <span style={sectionHint}>Solo la ruta hasta cada servidor. Sirve como evidencia ante el proveedor si sube.</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {pings.map((r) => (
              <div key={r.serviceId} style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/monitoreo/servidores/${r.serverId}`} style={{ fontWeight: 600, color: INK, fontSize: 14 }} className="hover:underline">{r.serverName}</Link>
                    <div style={{ fontSize: 12, color: MUTED }}>{clientName.get(r.clientId) ?? '—'} · {r.target}</div>
                  </div>
                  <StatusPill r={r} />
                </div>
                <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end' }}>
                  <div>
                    <div style={{ fontSize: 11, color: MUTED, display: 'flex', alignItems: 'center', gap: 5 }}><PeFlag />Desde Perú</div>
                    <Latency p={r.office} threshold={r.latencyThresholdMs} big />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: MUTED }}>Desde servidor</div>
                    <Latency p={r.datacenter} threshold={r.latencyThresholdMs} />
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: 11, color: MUTED, textAlign: 'right' }}>umbral<br />{r.latencyThresholdMs} ms</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Link to={`/monitoreo/servidores/${r.serverId}`} style={{ fontSize: 12 }} className="text-blue-700 hover:underline">Ver historial por hora</Link>
                  {checkBtn(r.serviceId)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
