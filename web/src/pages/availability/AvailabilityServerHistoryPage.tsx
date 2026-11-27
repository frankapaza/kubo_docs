import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { availabilityApi, HistoryPoint, HistoryRange } from '../../api/availability.api';
import { clientsApi } from '../../api/clients.api';
import { tableWrap, td, th } from './availability-ui';
import { agentStatus, fmtLima } from './report-format';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const RANGES: Array<{ id: HistoryRange; label: string; hint: string }> = [
  { id: 'day', label: 'Día', hint: 'Últimas 24 horas, cada 15 minutos' },
  { id: 'month', label: 'Mes', hint: 'Últimos 30 días, un punto por día' },
  { id: 'year', label: 'Año', hint: 'Últimos 12 meses, un punto por mes' },
];

const INK = '#1f2937';
const MUTED = '#6d7577';
const GRID = '#eef0f1';
const CPU = '#2563eb';
const RAM = '#9333ea';
const ERR = '#c2410c';

const card: React.CSSProperties = { border: '1px solid #e6e9ea', borderRadius: 10, padding: 14, background: '#fff' };
const sub: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 };

/** Etiqueta corta del tramo según el rango. */
function label(p: HistoryPoint, range: HistoryRange): string {
  if (range === 'day') return p.key.slice(11, 16);
  if (range === 'month') return `${Number(p.key.slice(8, 10))} ${MONTHS[Number(p.key.slice(5, 7)) - 1]}`;
  return `${MONTHS[Number(p.key.slice(5, 7)) - 1]} ${p.key.slice(2, 4)}`;
}

/** Etiqueta larga para el tooltip y la tabla. */
function longLabel(p: HistoryPoint, range: HistoryRange): string {
  if (range === 'day') {
    const d = p.key.slice(0, 10);
    return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${p.key.slice(11, 16)}`;
  }
  if (range === 'month') return `${label(p, range)} ${p.key.slice(0, 4)}`;
  return `${MONTHS[Number(p.key.slice(5, 7)) - 1]} ${p.key.slice(0, 4)}`;
}

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} %`);

export default function AvailabilityServerHistoryPage() {
  const serverId = Number(useParams().serverId);
  const [range, setRange] = useState<HistoryRange>('day');
  const [showTable, setShowTable] = useState(false);

  const servers = useQuery({ queryKey: ['availability', 'servers'], queryFn: availabilityApi.listServers, staleTime: 60_000 });
  const clients = useQuery({ queryKey: ['availability', 'clients'], queryFn: () => clientsApi.list(), staleTime: 5 * 60_000 });
  const view = useQuery({ queryKey: ['availability', 'agent', serverId], queryFn: () => availabilityApi.agentView(serverId), refetchInterval: 60_000 });
  const history = useQuery({
    queryKey: ['availability', 'history', serverId, range],
    queryFn: () => availabilityApi.serverHistory(serverId, range),
    refetchInterval: range === 'day' ? 60_000 : 5 * 60_000,
  });

  const server = (servers.data ?? []).find((s) => s.id === serverId);
  const clientName = (clients.data ?? []).find((c) => c.id === server?.clientId)?.razonSocial ?? '';
  const points = history.data?.points ?? [];
  const totals = useMemo(() => summarize(points), [points]);
  const st = server ? agentStatus(server.agentTokenCreatedAt !== null, view.data?.lastSampleAt ?? null, Date.now()) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Link to="/monitoreo/servidores" style={{ fontSize: 12, color: MUTED }}>← Servidores</Link>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          <h1 className="text-xl font-semibold text-slate-900">{server?.name ?? `Servidor #${serverId}`}</h1>
          <span style={{ fontSize: 13, color: MUTED }}>{clientName}{server?.host ? ` · ${server.host}` : ''}</span>
          {st && (
            <span style={{ fontSize: 12, fontWeight: 600, borderRadius: 4, padding: '2px 7px', ...(st.kind === 'reporting' ? { background: '#e6f4ea', color: '#1e7a3c' } : st.kind === 'silent' ? { background: '#fdecea', color: '#b3261e' } : { background: '#eef0f1', color: MUTED }) }}>
              {st.kind === 'reporting' ? 'Reportando' : st.kind === 'silent' ? 'Sin datos recientes' : 'Sin agente'}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div role="tablist" aria-label="Rango" style={{ display: 'inline-flex', border: '1px solid #d8dcdd', borderRadius: 8, overflow: 'hidden' }}>
          {RANGES.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={range === r.id}
              type="button"
              onClick={() => setRange(r.id)}
              title={r.hint}
              style={{ fontSize: 13, padding: '6px 16px', border: 'none', cursor: 'pointer', background: range === r.id ? INK : '#fff', color: range === r.id ? '#fff' : INK, fontWeight: range === r.id ? 600 : 400 }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: MUTED }}>{RANGES.find((r) => r.id === range)!.hint} · hora de Lima</span>
        <button type="button" onClick={() => setShowTable((v) => !v)} style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 10px', borderRadius: 6, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}>
          {showTable ? 'Ver gráficos' : 'Ver tabla'}
        </button>
      </div>

      {history.isLoading && <div style={{ fontSize: 13, color: MUTED }}>Cargando…</div>}
      {history.error && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudo cargar el historial.</div>}

      {history.data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Tile label="CPU media" value={pct(totals.cpuAvg)} hint={`máx. ${pct(totals.cpuMax)}`} />
            <Tile label="RAM media" value={pct(totals.ramAvg)} hint={`máx. ${pct(totals.ramMax)}`} />
            <Tile label="Errores del Visor" value={String(totals.errors)} hint="Sistema + Aplicación" />
            <Tile label="Muestras" value={totals.samples.toLocaleString('es-PE')} hint={totals.samples === 0 ? 'sin datos en el rango' : 'una por minuto'} />
          </div>

          {totals.samples === 0 && (
            <div style={{ fontSize: 13, color: MUTED }}>
              No hay datos del agente en este rango.{range === 'year' ? ' Los meses se completan con el resumen diario de cada noche.' : ''}
            </div>
          )}

          {showTable ? (
            <HistoryTable points={points} range={range} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14 }}>
              <LineChart title="CPU" color={CPU} points={points} range={range} avg={(p) => p.cpuAvg} max={(p) => p.cpuMax} />
              <LineChart title="RAM" color={RAM} points={points} range={range} avg={(p) => p.ramAvg} max={(p) => p.ramMax} />
              <BarChart title="Errores del Visor de eventos" color={ERR} points={points} range={range} />
            </div>
          )}
          {view.data?.lastSampleAt && <div style={{ fontSize: 12, color: MUTED }}>Última muestra: {fmtLima(view.data.lastSampleAt)}</div>}
        </>
      )}
    </div>
  );
}

function summarize(points: HistoryPoint[]) {
  const withData = points.filter((p) => p.samples > 0);
  const samples = withData.reduce((a, p) => a + p.samples, 0);
  const wavg = (pick: (p: HistoryPoint) => number | null) => {
    const u = withData.filter((p) => pick(p) !== null);
    const n = u.reduce((a, p) => a + p.samples, 0);
    return n === 0 ? null : u.reduce((a, p) => a + (pick(p) as number) * p.samples, 0) / n;
  };
  const max = (pick: (p: HistoryPoint) => number | null) => {
    const v = withData.map(pick).filter((x): x is number => x !== null);
    return v.length ? Math.max(...v) : null;
  };
  return {
    samples,
    cpuAvg: wavg((p) => p.cpuAvg),
    cpuMax: max((p) => p.cpuMax),
    ramAvg: wavg((p) => p.ramAvg),
    ramMax: max((p) => p.ramMax),
    errors: points.reduce((a, p) => a + p.errors, 0),
  };
}

function Tile({ label: l, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={card}>
      <div style={sub}>{l}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11, color: MUTED }}>{hint}</div>
    </div>
  );
}

// ---------------------------------------------------------------- gráficos

const W = 560;
const H = 200;
const PAD = { l: 40, r: 12, t: 10, b: 28 };
const innerW = W - PAD.l - PAD.r;
const innerH = H - PAD.t - PAD.b;

/** Índices de las etiquetas del eje X: unas 6, repartidas. */
function tickIndexes(n: number): number[] {
  if (n <= 1) return [0];
  const step = Math.max(1, Math.round((n - 1) / 6));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1 && n - 1 - out[out.length - 1] > step / 2) out.push(n - 1);
  return out;
}

const xAt = (i: number, n: number) => PAD.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);

/** Tramos continuos de puntos con valor (los huecos sin datos cortan la línea). */
function segments(values: Array<number | null>, n: number, y: (v: number) => number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) out.push(cur.join(' '));
      cur = [];
    } else cur.push(`${xAt(i, n).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) out.push(cur.join(' '));
  return out;
}

function ChartFrame({ title, legend, children }: { title: string; legend?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: INK }}>{title}</h2>
        {legend}
      </div>
      {children}
    </section>
  );
}

function Tooltip({ x, lines }: { x: number; lines: Array<[string, string]> }) {
  const left = Math.min(Math.max((x / W) * 100, 12), 88);
  return (
    <div style={{ position: 'absolute', top: 4, left: `${left}%`, transform: 'translateX(-50%)', background: '#fff', border: '1px solid #d8dcdd', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: INK, boxShadow: '0 2px 8px rgba(0,0,0,.08)', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 1 }}>
      {lines.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: i === 0 ? 600 : 400 }}>
          <span style={{ color: i === 0 ? INK : MUTED }}>{k}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Índice del punto más cercano al ratón. */
function useHover(n: number) {
  const [idx, setIdx] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = n <= 1 ? 0 : Math.round(((x - PAD.l) / innerW) * (n - 1));
    setIdx(Math.min(Math.max(i, 0), n - 1));
  };
  return { idx, onMove, onLeave: () => setIdx(null) };
}

function Axes({ points, range, yTicks, yFmt }: { points: HistoryPoint[]; range: HistoryRange; yTicks: number[]; yFmt: (v: number) => string; }) {
  const n = points.length;
  const y = (v: number) => PAD.t + innerH - (v / yTicks[yTicks.length - 1]) * innerH;
  return (
    <g>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={PAD.l - 6} y={y(t) + 4.5} textAnchor="end" fontSize={13} fill={MUTED}>{yFmt(t)}</text>
        </g>
      ))}
      {tickIndexes(n).map((i) => (
        <text key={i} x={xAt(i, n)} y={H - 6} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} fontSize={13} fill={MUTED}>{label(points[i], range)}</text>
      ))}
    </g>
  );
}

function LineChart({ title, color, points, range, avg, max }: {
  title: string; color: string; points: HistoryPoint[]; range: HistoryRange;
  avg: (p: HistoryPoint) => number | null; max: (p: HistoryPoint) => number | null;
}) {
  const n = points.length;
  const yTicks = [0, 25, 50, 75, 100];
  const y = (v: number) => PAD.t + innerH - (Math.min(Math.max(v, 0), 100) / 100) * innerH;
  const hover = useHover(n);
  const avgVals = points.map(avg);
  const maxVals = points.map(max);
  const h = hover.idx;
  const legend = (
    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: MUTED }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2" /></svg>Media</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2" strokeDasharray="4 3" opacity="0.55" /></svg>Máximo</span>
    </div>
  );
  return (
    <ChartFrame title={`${title} (%)`} legend={legend}>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}: media y máximo por tramo`} style={{ display: 'block' }}>
          <Axes points={points} range={range} yTicks={yTicks} yFmt={(v) => `${v}`} />
          {segments(maxVals, n, y).map((pts, i) => (
            <polyline key={`m${i}`} points={pts} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 3" opacity={0.55} strokeLinejoin="round" />
          ))}
          {segments(avgVals, n, y).map((pts, i) => (
            <polyline key={`a${i}`} points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {h !== null && (
            <g>
              <line x1={xAt(h, n)} x2={xAt(h, n)} y1={PAD.t} y2={PAD.t + innerH} stroke={MUTED} strokeWidth={1} strokeDasharray="2 2" />
              {avgVals[h] !== null && <circle cx={xAt(h, n)} cy={y(avgVals[h] as number)} r={4} fill={color} stroke="#fff" strokeWidth={2} />}
            </g>
          )}
          <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} fill="transparent" onMouseMove={hover.onMove} onMouseLeave={hover.onLeave} />
        </svg>
        {h !== null && (
          <Tooltip
            x={xAt(h, n)}
            lines={[
              [longLabel(points[h], range), ''],
              ['Media', pct(avgVals[h])],
              ['Máximo', pct(maxVals[h])],
              ['Muestras', String(points[h].samples)],
            ]}
          />
        )}
      </div>
    </ChartFrame>
  );
}

function BarChart({ title, color, points, range }: { title: string; color: string; points: HistoryPoint[]; range: HistoryRange }) {
  const n = points.length;
  const top = Math.max(4, ...points.map((p) => p.errors));
  const nice = top <= 4 ? 4 : Math.ceil(top / 4) * 4;
  const yTicks = [0, nice / 4, nice / 2, (3 * nice) / 4, nice];
  const y = (v: number) => PAD.t + innerH - (v / nice) * innerH;
  const slot = innerW / Math.max(n, 1);
  const bw = Math.max(1, Math.min(slot - 2, 24));
  const hover = useHover(n);
  const h = hover.idx;
  return (
    <ChartFrame title={title}>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title} por tramo`} style={{ display: 'block' }}>
          <Axes points={points} range={range} yTicks={yTicks} yFmt={(v) => (Number.isInteger(v) ? String(v) : '')} />
          {points.map((p, i) => {
            if (p.errors <= 0) return null;
            const x = xAt(i, n) - bw / 2;
            const yy = y(p.errors);
            const hh = PAD.t + innerH - yy;
            const r = Math.min(4, bw / 2, hh);
            // Barra con las esquinas de arriba redondeadas y la base recta sobre el eje.
            return (
              <path
                key={i}
                d={`M${x},${PAD.t + innerH} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${PAD.t + innerH} Z`}
                fill={color}
                opacity={h === null || h === i ? 1 : 0.45}
              />
            );
          })}
          <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} fill="transparent" onMouseMove={hover.onMove} onMouseLeave={hover.onLeave} />
        </svg>
        {h !== null && <Tooltip x={xAt(h, n)} lines={[[longLabel(points[h], range), ''], ['Errores', String(points[h].errors)]]} />}
      </div>
    </ChartFrame>
  );
}

function HistoryTable({ points, range }: { points: HistoryPoint[]; range: HistoryRange }) {
  return (
    <div style={tableWrap}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', background: '#f7f8f8', color: MUTED, fontSize: 12 }}>
            {['Tramo', 'CPU media', 'CPU máx.', 'RAM media', 'RAM máx.', 'Errores', 'Muestras'].map((c) => <th key={c} style={th}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.key} style={{ borderTop: '1px solid #eef0f1' }}>
              <td style={td}>{longLabel(p, range)}</td>
              <td style={td}>{pct(p.cpuAvg)}</td>
              <td style={td}>{pct(p.cpuMax)}</td>
              <td style={td}>{pct(p.ramAvg)}</td>
              <td style={td}>{pct(p.ramMax)}</td>
              <td style={td}>{p.errors}</td>
              <td style={td}>{p.samples}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
