import type { Criticality } from '../core';
import { incidentIntervals } from './incident-intervals';
import { LATENCY_BUCKETS_MS, mergeHistograms, PERCENT_BUCKETS, percentileFromHistogram } from './latency-histogram';
import { MaintenanceWindow, maintenanceIntervalsFor } from './maintenance';

/** Contenido congelado del informe mensual (`monitor_monthly_reports.data`). La web lo pinta tal cual. */
export interface AvailabilityReportData {
  version: 1;
  clientId: number;
  clientName: string;
  month: string;
  partial: boolean;
  from: string;
  to: string;
  generatedAt: string;
  criteria: string[];
  totals: {
    availabilityPct: number | null;
    peruAccessPct: number | null;
    mttrMinutes: number | null;
    incidents: number;
    downMinutes: number;
    routeMinutes: number;
    maintenanceMinutes: number;
  };
  services: Array<{
    serviceId: number;
    serviceName: string;
    serverName: string;
    systemName: string | null;
    criticality: Criticality;
    availabilityPct: number | null;
    peruAccessPct: number | null;
    downMinutes: number;
    routeMinutes: number;
    maintenanceMinutes: number;
    incidents: number;
    latency: { office: { p50: number | null; p95: number | null }; datacenter: { p50: number | null; p95: number | null } };
    coverage: { office: number | null; datacenter: number | null };
  }>;
  incidents: Array<{
    incidentId: number;
    kind: 'DOWN' | 'ROUTE';
    serverName: string;
    serviceNames: string[];
    firstFailureAt: string;
    recoveredAt: string | null;
    minutesInMonth: number;
    ticketId: number | null;
    ticketCode: string | null;
    evidence: Array<{ id: number; origin: string; capturedAt: string; fileName: string }>;
  }>;
  noDataWindows: Array<{
    probeCode: string;
    cause: 'OFFICE_OUTAGE' | 'PROBE_SILENT';
    startedAt: string;
    endedAt: string;
    minutes: number;
  }>;
  maintenance: Array<{ targetLabel: string; startsAt: string; endsAt: string; reason: string; minutesInMonth: number }>;
  servers: Array<{
    serverName: string;
    cpuP95: number | null;
    ramP95: number | null;
    disksAtClose: Array<{ name: string; freePct: number }>;
  }>;
}

export interface ReportServer {
  id: number;
  name: string;
}

export interface ReportServiceInput {
  id: number;
  name: string;
  serverId: number;
  systemName: string | null;
  criticality: Criticality;
}

export interface ReportProbe {
  id: number;
  code: string;
  kind: 'OFFICE' | 'DATACENTER';
}

/** Incidente de servicio (hijo o suelto). `upgradedAt` = `at` del primer `UPGRADED_TO_DOWN`. */
export interface ReportServiceIncident {
  id: number;
  serviceId: number;
  kind: 'DOWN' | 'ROUTE' | 'DEGRADED';
  firstFailureAt: Date;
  recoveredAt: Date | null;
  upgradedAt: Date | null;
}

/** Incidente de primer nivel (`parent_id` nulo): de servidor (`serviceId` nulo) o de servicio suelto. */
export interface ReportTopIncident {
  id: number;
  serviceId: number | null;
  serverId: number;
  kind: 'DOWN' | 'ROUTE' | 'DEGRADED';
  serviceNames: string[];
  firstFailureAt: Date;
  recoveredAt: Date | null;
  ticketId: number | null;
  ticketCode: string | null;
  evidence: Array<{ id: number; origin: string; capturedAt: Date; fileName: string }>;
}

export interface ReportRollup {
  serviceId: number;
  probeId: number;
  date: string;
  expected: number;
  executed: number;
  latencyHist: number[];
}

export interface ReportGap {
  probeId: number;
  cause: 'OFFICE_OUTAGE' | 'PROBE_SILENT';
  startedAt: Date;
  endedAt: Date;
  date: string;
}

export interface ReportAgentRollup {
  serverId: number;
  date: string;
  cpuHist: number[];
  ramHist: number[];
  disksClose: Array<{ name: string; totalBytes: number; freeBytes: number }>;
}

export interface ReportInput {
  client: { id: number; name: string };
  month: string;
  /** 00:00 de Lima del día 1. */
  from: Date;
  /** `min(fin de mes, now)`. */
  to: Date;
  partial: boolean;
  generatedAt: Date;
  /** Servidores del cliente que salen en el informe. */
  servers: ReportServer[];
  services: ReportServiceInput[];
  probes: ReportProbe[];
  incidents: ReportServiceIncident[];
  topIncidents: ReportTopIncident[];
  maintenance: MaintenanceWindow[];
  rollups: ReportRollup[];
  gaps: ReportGap[];
  agentRollups: ReportAgentRollup[];
}

/** El criterio de cálculo, escrito en el propio informe (spec «Disponibilidad mensual»). */
export const REPORT_CRITERIA: string[] = [
  'T = minutos del mes − minutos de mantenimiento del servicio. En un informe parcial, el mes llega hasta el momento de la generación.',
  'Disponibilidad del servicio = 1 − DOWN ÷ T, donde DOWN son los minutos de incidentes DOWN.',
  'Acceso desde Perú = 1 − (DOWN + ROUTE) ÷ T, donde ROUTE son los minutos en que el servicio respondía desde el servidor pero no desde Perú.',
  'Las cifras del cliente son sumas sobre sus servicios, no promedios: 1 − ΣDOWN ÷ ΣT y 1 − Σ(DOWN + ROUTE) ÷ ΣT.',
  'Duración de un incidente: desde la primera falla hasta la recuperación, recortada a los límites del mes y descontando el mantenimiento superpuesto. Un incidente abierto cuenta hasta el cierre del informe.',
  'Un incidente que pasó de ROUTE a DOWN cuenta como ROUTE hasta ese momento y como DOWN desde entonces.',
  'Tiempo medio de recuperación = promedio de las duraciones de los incidentes DOWN y ROUTE de primer nivel cerrados en el mes (una caída de servidor cuenta una vez). Los abiertos al cierre no entran.',
  'Cobertura de cada sonda = comprobaciones regulares ejecutadas ÷ esperadas, en porcentaje, hasta el día anterior a la generación. Vacía si la sonda no tiene resúmenes en el mes.',
  'Latencia P50/P95: de los histogramas diarios de las comprobaciones exitosas, exacta a la cubeta.',
  'Los minutos sin datos desde la oficina no cuentan como caída.',
  'Durante esas ventanas sin datos decide la sonda del servidor; se listan aparte.',
  'Porcentajes con 3 decimales; minutos con 2. Una cifra vacía indica que T es 0 (todo el período en mantenimiento).',
];

const MIN_MS = 60_000;
type Span = [number, number];

const round = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
const pct = (lost: number, T: number): number | null => (T <= 0 ? null : round((1 - lost / T) * 100, 3));
const spanMin = (spans: Span[]) => spans.reduce((a, [x, y]) => a + (y - x), 0) / MIN_MS;

/** Une tramos que se superponen o se tocan. */
function union(spans: Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** `spans` menos `cuts` (ambos en cualquier orden). */
function subtract(spans: Span[], cuts: Span[]): Span[] {
  const cs = union(cuts);
  const out: Span[] = [];
  for (const [a, b] of union(spans)) {
    let cur = a;
    for (const [x, y] of cs) {
      if (y <= cur || x >= b) continue;
      if (x > cur) out.push([cur, x]);
      cur = Math.max(cur, y);
      if (cur >= b) break;
    }
    if (cur < b) out.push([cur, b]);
  }
  return out;
}

const clip = (s: Span, lo: number, hi: number): Span => [Math.max(s[0], lo), Math.min(s[1], hi)];
const toSpans = (xs: Array<[Date, Date]>): Span[] => xs.map(([a, b]) => [a.getTime(), b.getTime()]);

/**
 * Informe mensual de disponibilidad de un cliente. Función pura: recibe todo lo
 * que necesita y nunca incluye datos ajenos al cliente (filtra por sus
 * servidores y servicios aunque la entrada traiga de más).
 */
export function computeAvailabilityReport(input: ReportInput): AvailabilityReportData {
  const lo = input.from.getTime();
  const hi = input.to.getTime();
  const monthMin = Math.max(0, hi - lo) / MIN_MS;

  const serverName = new Map(input.servers.map((s) => [s.id, s.name]));
  const services = input.services.filter((s) => serverName.has(s.serverId));
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const probeById = new Map(input.probes.map((p) => [p.id, p]));

  // Mantenimiento de un servicio y de un servidor (este último solo con las ventanas del servidor).
  const serviceMaint = (svc: ReportServiceInput): Span[] =>
    toSpans(maintenanceIntervalsFor(svc.id, svc.serverId, input.maintenance, input.from, input.to));
  const serverMaint = (serverId: number): Span[] =>
    toSpans(
      maintenanceIntervalsFor(
        -1,
        serverId,
        input.maintenance.filter((w) => w.serviceId === null || w.serviceId === undefined),
        input.from,
        input.to,
      ),
    );

  // --- Servicios ---
  let sumT = 0;
  let sumDown = 0;
  let sumRoute = 0;
  let sumMaint = 0;
  const serviceRows: AvailabilityReportData['services'] = services.map((svc) => {
    const maint = serviceMaint(svc);
    const maintMin = spanMin(maint);
    const T = monthMin - maintMin;

    const downSpans: Span[] = [];
    const routeSpans: Span[] = [];
    let incidents = 0;
    for (const inc of input.incidents) {
      if (inc.serviceId !== svc.id || inc.kind === 'DEGRADED') continue;
      const ivs = incidentIntervals(inc, inc.upgradedAt, input.to)
        .map((iv) => ({ kind: iv.kind, span: clip([iv.from.getTime(), iv.to.getTime()], lo, hi) }))
        .filter((x) => x.span[1] > x.span[0]);
      if (ivs.length === 0) continue;
      incidents++;
      for (const iv of ivs) (iv.kind === 'DOWN' ? downSpans : routeSpans).push(iv.span);
    }
    const down = subtract(downSpans, maint);
    // ROUTE sin lo que ya cuenta como DOWN: un minuto no se cuenta dos veces.
    const route = subtract(subtract(routeSpans, maint), down);
    const downMin = spanMin(down);
    const routeMin = spanMin(route);

    sumT += Math.max(0, T);
    sumDown += downMin;
    sumRoute += routeMin;
    sumMaint += maintMin;

    return {
      serviceId: svc.id,
      serviceName: svc.name,
      serverName: serverName.get(svc.serverId) ?? '',
      systemName: svc.systemName,
      criticality: svc.criticality,
      availabilityPct: pct(downMin, T),
      peruAccessPct: pct(downMin + routeMin, T),
      downMinutes: round(downMin, 2),
      routeMinutes: round(routeMin, 2),
      maintenanceMinutes: round(maintMin, 2),
      incidents,
      latency: {
        office: latencyOf(input, svc.id, 'OFFICE', probeById),
        datacenter: latencyOf(input, svc.id, 'DATACENTER', probeById),
      },
      coverage: {
        office: coverageOf(input, svc.id, 'OFFICE', probeById),
        datacenter: coverageOf(input, svc.id, 'DATACENTER', probeById),
      },
    };
  });

  // --- Incidentes de primer nivel ---
  const tops = input.topIncidents
    .filter((t) => serverName.has(t.serverId) && (t.serviceId === null || serviceById.has(t.serviceId)))
    .filter((t): t is ReportTopIncident & { kind: 'DOWN' | 'ROUTE' } => t.kind !== 'DEGRADED')
    .map((t) => {
      const end = t.recoveredAt ? t.recoveredAt.getTime() : hi;
      const span = clip([t.firstFailureAt.getTime(), end], lo, hi);
      const svc = t.serviceId === null ? null : serviceById.get(t.serviceId)!;
      const maint = svc ? serviceMaint(svc) : serverMaint(t.serverId);
      const minutes = span[1] > span[0] ? spanMin(subtract([span], maint)) : 0;
      return { t, span, minutes };
    })
    .filter((x) => x.span[1] > x.span[0])
    .sort((a, b) => a.t.firstFailureAt.getTime() - b.t.firstFailureAt.getTime() || a.t.id - b.t.id);

  const closed = tops.filter((x) => x.t.recoveredAt !== null && x.t.recoveredAt.getTime() <= hi && x.minutes > 0);
  const mttr = closed.length ? round(closed.reduce((a, x) => a + x.minutes, 0) / closed.length, 2) : null;

  const incidents: AvailabilityReportData['incidents'] = tops.map(({ t, minutes }) => ({
    incidentId: t.id,
    kind: t.kind,
    serverName: serverName.get(t.serverId) ?? '',
    serviceNames: t.serviceNames,
    firstFailureAt: t.firstFailureAt.toISOString(),
    recoveredAt: t.recoveredAt ? t.recoveredAt.toISOString() : null,
    minutesInMonth: round(minutes, 2),
    ticketId: t.ticketId,
    ticketCode: t.ticketCode,
    evidence: t.evidence.map((e) => ({ id: e.id, origin: e.origin, capturedAt: e.capturedAt.toISOString(), fileName: e.fileName })),
  }));

  return {
    version: 1,
    clientId: input.client.id,
    clientName: input.client.name,
    month: input.month,
    partial: input.partial,
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    generatedAt: input.generatedAt.toISOString(),
    criteria: [...REPORT_CRITERIA],
    totals: {
      availabilityPct: pct(sumDown, sumT),
      peruAccessPct: pct(sumDown + sumRoute, sumT),
      mttrMinutes: mttr,
      incidents: incidents.length,
      downMinutes: round(sumDown, 2),
      routeMinutes: round(sumRoute, 2),
      maintenanceMinutes: round(sumMaint, 2),
    },
    services: serviceRows,
    incidents,
    noDataWindows: noDataWindows(input, probeById, lo, hi),
    maintenance: maintenanceRows(input, serverName, serviceById, lo, hi),
    servers: serverRows(input),
  };
}

function rollupsOf(input: ReportInput, serviceId: number, kind: ReportProbe['kind'], probes: Map<number, ReportProbe>) {
  return input.rollups.filter((r) => r.serviceId === serviceId && probes.get(r.probeId)?.kind === kind);
}

function latencyOf(
  input: ReportInput,
  serviceId: number,
  kind: ReportProbe['kind'],
  probes: Map<number, ReportProbe>,
): { p50: number | null; p95: number | null } {
  const rows = rollupsOf(input, serviceId, kind, probes);
  if (rows.length === 0) return { p50: null, p95: null };
  const h = mergeHistograms(rows.map((r) => r.latencyHist ?? []));
  return { p50: percentileFromHistogram(h, 0.5, LATENCY_BUCKETS_MS), p95: percentileFromHistogram(h, 0.95, LATENCY_BUCKETS_MS) };
}

/** Σejecutadas ÷ Σesperadas en porcentaje (3 decimales). Sin resúmenes (sonda aún no desplegada) → null. */
function coverageOf(input: ReportInput, serviceId: number, kind: ReportProbe['kind'], probes: Map<number, ReportProbe>): number | null {
  const rows = rollupsOf(input, serviceId, kind, probes);
  const expected = rows.reduce((a, r) => a + Number(r.expected), 0);
  if (rows.length === 0 || expected <= 0) return null;
  const executed = rows.reduce((a, r) => a + Number(r.executed), 0);
  return round((executed / expected) * 100, 3);
}

/** Huecos de sonda recortados al mes; los contiguos de la misma sonda y causa (p. ej. cruzando medianoche) se unen. */
function noDataWindows(
  input: ReportInput,
  probes: Map<number, ReportProbe>,
  lo: number,
  hi: number,
): AvailabilityReportData['noDataWindows'] {
  const groups = new Map<string, { probeId: number; cause: ReportGap['cause']; spans: Span[] }>();
  for (const g of input.gaps) {
    const span = clip([g.startedAt.getTime(), g.endedAt.getTime()], lo, hi);
    if (span[1] <= span[0]) continue;
    const key = `${g.probeId}|${g.cause}`;
    const grp = groups.get(key) ?? groups.set(key, { probeId: g.probeId, cause: g.cause, spans: [] }).get(key)!;
    grp.spans.push(span);
  }
  const out: Array<AvailabilityReportData['noDataWindows'][number] & { probeId: number; s: number }> = [];
  for (const grp of groups.values()) {
    for (const [a, b] of union(grp.spans)) {
      out.push({
        probeId: grp.probeId,
        s: a,
        probeCode: probes.get(grp.probeId)?.code ?? `sonda-${grp.probeId}`,
        cause: grp.cause,
        startedAt: new Date(a).toISOString(),
        endedAt: new Date(b).toISOString(),
        minutes: round((b - a) / MIN_MS, 2),
      });
    }
  }
  return out
    .sort((x, y) => x.s - y.s || x.probeId - y.probeId)
    .map(({ probeCode, cause, startedAt, endedAt, minutes }) => ({ probeCode, cause, startedAt, endedAt, minutes }));
}

/** Ventanas que alcanzan a un servidor o servicio del cliente, con sus minutos dentro del mes. */
function maintenanceRows(
  input: ReportInput,
  serverName: Map<number, string>,
  serviceById: Map<number, ReportServiceInput>,
  lo: number,
  hi: number,
): AvailabilityReportData['maintenance'] {
  const out: Array<AvailabilityReportData['maintenance'][number] & { s: number }> = [];
  for (const w of input.maintenance) {
    let targetLabel: string;
    if (w.serviceId !== null && w.serviceId !== undefined) {
      const svc = serviceById.get(Number(w.serviceId));
      if (!svc) continue;
      targetLabel = `${serverName.get(svc.serverId) ?? ''} · ${svc.name}`;
    } else {
      const name = w.serverId === null || w.serverId === undefined ? undefined : serverName.get(Number(w.serverId));
      if (name === undefined) continue;
      targetLabel = name;
    }
    const span = clip([w.startsAt.getTime(), w.endsAt.getTime()], lo, hi);
    if (span[1] <= span[0]) continue;
    out.push({
      s: w.startsAt.getTime(),
      targetLabel,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
      reason: w.reason,
      minutesInMonth: round((span[1] - span[0]) / MIN_MS, 2),
    });
  }
  return out.sort((a, b) => a.s - b.s).map(({ s: _s, ...row }) => row);
}

/** CPU y RAM P95 de los histogramas diarios sumados; discos del último día con datos. */
function serverRows(input: ReportInput): AvailabilityReportData['servers'] {
  return input.servers.map((srv) => {
    const rows = input.agentRollups.filter((r) => r.serverId === srv.id);
    if (rows.length === 0) return { serverName: srv.name, cpuP95: null, ramP95: null, disksAtClose: [] };
    const last = rows.reduce((a, r) => (r.date > a.date ? r : a));
    return {
      serverName: srv.name,
      cpuP95: percentileFromHistogram(mergeHistograms(rows.map((r) => r.cpuHist ?? [])), 0.95, PERCENT_BUCKETS),
      ramP95: percentileFromHistogram(mergeHistograms(rows.map((r) => r.ramHist ?? [])), 0.95, PERCENT_BUCKETS),
      disksAtClose: (last.disksClose ?? [])
        .filter((d) => Number(d.totalBytes) > 0)
        .map((d) => ({ name: d.name, freePct: round((Number(d.freeBytes) / Number(d.totalBytes)) * 100, 1) })),
    };
  });
}
