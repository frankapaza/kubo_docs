import { useQuery } from '@tanstack/react-query';

import { availabilityApi, LatencyHourRow } from '../../api/availability.api';

const MUTED = '#6d7577';
const GRID = '#eef0f1';
const LINE = '#053777';
const LIMIT = '#b3261e';
const BAR_SLOW = '#c2410c';
const BAR_OK = '#b8c2cc';

const W = 1400;
const H = 200;
const PAD = { l: 48, r: 12, t: 10, b: 24 };

const fmtHour = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(iso));
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', timeZone: 'America/Lima' }).format(new Date(iso));

const card: React.CSSProperties = { border: '1px solid #e6e9ea', borderRadius: 10, padding: 14, background: '#fff' };

/**
 * Ping desde la oficina por hora (últimos 7 días): promedio frente al umbral y
 * cuántos pings pasaron el umbral cada hora (spec 2026-11-28-alerta-latencia).
 * Dos gráficos, una escala cada uno: nunca dos ejes en el mismo.
 */
export default function LatencyPanel({ serverId }: { serverId: number }) {
  const q = useQuery({ queryKey: ['availability', 'latency', serverId], queryFn: () => availabilityApi.serverLatency(serverId, 7), refetchInterval: 5 * 60_000 });
  if (q.isLoading || !q.data) return null;
  const { service, hours } = q.data;
  if (!service) return null;

  const slowHours = hours.filter((h) => h.isSlow).length;
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Ping desde la oficina, por hora</div>
        <span style={{ fontSize: 12, color: MUTED }}>
          {service.target} · umbral {service.latencyThresholdMs} ms · últimos 7 días · hora de Lima
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: slowHours ? BAR_SLOW : '#1e7a3c' }}>
          {slowHours ? `${slowHours} hora(s) lenta(s)` : 'Sin horas lentas'}
        </span>
      </div>
      {hours.length === 0 ? (
        <div style={{ fontSize: 13, color: MUTED }}>Todavía no hay horas medidas. La primera aparece a los 5 minutos de cerrar la hora.</div>
      ) : (
        <>
          <AvgChart hours={hours} threshold={service.latencyThresholdMs} />
          <SlowBars hours={hours} />
        </>
      )}
    </div>
  );
}

const HOUR_MS = 3_600_000;

/** Ancho de una hora en el gráfico (el eje es de tiempo real: las horas sin datos quedan como hueco). */
function slotW(hours: LatencyHourRow[]): number {
  const t0 = Date.parse(hours[0].hourStart);
  const t1 = Date.parse(hours[hours.length - 1].hourStart);
  return (W - PAD.l - PAD.r) / ((t1 - t0) / HOUR_MS + 1);
}

/** Centro de la hora i, dentro del área del gráfico. */
function xAt(hours: LatencyHourRow[], i: number): number {
  const t0 = Date.parse(hours[0].hourStart);
  return PAD.l + slotW(hours) * ((Date.parse(hours[i].hourStart) - t0) / HOUR_MS + 0.5);
}

function dayTicks(hours: LatencyHourRow[]): Array<{ i: number; label: string }> {
  const out: Array<{ i: number; label: string }> = [];
  let last = '';
  hours.forEach((h, i) => {
    const d = fmtDay(h.hourStart);
    if (d !== last) {
      out.push({ i, label: d });
      last = d;
    }
  });
  return out;
}

function Axis({ hours, max, unit }: { hours: LatencyHourRow[]; max: number; unit: string }) {
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  return (
    <>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke={GRID} />
          <text x={PAD.l - 6} y={y(max * f) + 4} fontSize="12" textAnchor="end" fill={MUTED}>{Math.round(max * f)}{unit}</text>
        </g>
      ))}
      {dayTicks(hours).map((t) => (
        <text key={t.i} x={xAt(hours, t.i)} y={H - 6} fontSize="12" fill={MUTED} textAnchor={xAt(hours, t.i) > W - 60 ? 'end' : 'start'}>{t.label}</text>
      ))}
    </>
  );
}

function AvgChart({ hours, threshold }: { hours: LatencyHourRow[]; threshold: number }) {
  const max = Math.max(threshold * 1.4, ...hours.map((h) => h.avgMs ?? 0)) || 1;
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const segments: string[][] = [];
  hours.forEach((h, i) => {
    const gap = i > 0 && Date.parse(h.hourStart) - Date.parse(hours[i - 1].hourStart) > HOUR_MS;
    if (h.avgMs === null) return void segments.push([]);
    if (segments.length === 0 || gap) segments.push([]);
    segments[segments.length - 1].push(`${xAt(hours, i).toFixed(1)},${y(h.avgMs).toFixed(1)}`);
  });
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontSize: 12, color: MUTED, marginBottom: 2 }}>
        Promedio por hora (ms) · <span style={{ color: LIMIT }}>- - umbral</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Ping promedio por hora">
        <Axis hours={hours} max={max} unit="" />
        <line x1={PAD.l} x2={W - PAD.r} y1={y(threshold)} y2={y(threshold)} stroke={LIMIT} strokeDasharray="5 4" strokeWidth={1.5} />
        {segments.filter((p) => p.length > 0).map((p, k) => (
          <polyline key={k} points={p.join(' ')} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {hours.map((h, i) => (
          <rect key={i} x={xAt(hours, i) - 3} y={PAD.t} width={6} height={H - PAD.t - PAD.b} fill="transparent">
            <title>{`${fmtHour(h.hourStart)} · promedio ${h.avgMs ?? '—'} ms · p95 ${h.p95Ms ?? '—'} ms · máx ${h.maxMs ?? '—'} ms`}</title>
          </rect>
        ))}
      </svg>
    </figure>
  );
}

function SlowBars({ hours }: { hours: LatencyHourRow[] }) {
  const max = Math.max(10, ...hours.map((h) => h.slow));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const bw = Math.max(1, slotW(hours) - 1);
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontSize: 12, color: MUTED, marginBottom: 2 }}>
        Pings sobre el umbral por hora · <span style={{ color: BAR_SLOW }}>■ hora lenta (≥ 20 %)</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Pings lentos por hora">
        <Axis hours={hours} max={max} unit="" />
        {hours.map((h, i) => (
          <rect key={i} x={xAt(hours, i) - bw / 2} y={y(h.slow)} width={bw} height={Math.max(0, H - PAD.b - y(h.slow))} rx={1} fill={h.isSlow ? BAR_SLOW : BAR_OK}>
            <title>{`${fmtHour(h.hourStart)} · ${h.slow} de ${h.total} pings (${h.total ? Math.round((h.slow / h.total) * 100) : 0} %) sobre el umbral`}</title>
          </rect>
        ))}
      </svg>
    </figure>
  );
}
