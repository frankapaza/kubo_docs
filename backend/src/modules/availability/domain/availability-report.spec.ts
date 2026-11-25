import { computeAvailabilityReport, ReportInput } from './availability-report';
import { LATENCY_BUCKETS_MS, PERCENT_BUCKETS } from './latency-histogram';

// Septiembre 2026 en Lima: 30 días → T = 43200 min.
const FROM = new Date('2026-09-01T05:00:00.000Z');
const TO = new Date('2026-10-01T05:00:00.000Z');
const MIN = 60_000;
const at = (iso: string) => new Date(iso);
const plus = (d: Date, min: number) => new Date(d.getTime() + min * MIN);

function base(over: Partial<ReportInput> = {}): ReportInput {
  return {
    client: { id: 1, name: 'Cliente A' },
    month: '2026-09',
    from: FROM,
    to: TO,
    partial: false,
    generatedAt: at('2026-10-01T13:00:00.000Z'),
    servers: [{ id: 10, name: 'SRV-A' }],
    services: [{ id: 100, name: 'Web', serverId: 10, systemName: 'ERP', criticality: 'HIGH' }],
    probes: [
      { id: 1, code: 'oficina-01', kind: 'OFFICE' },
      { id: 2, code: 'kubo-01', kind: 'DATACENTER' },
    ],
    incidents: [],
    topIncidents: [],
    maintenance: [],
    rollups: [],
    gaps: [],
    agentRollups: [],
    ...over,
  };
}

const down = (id: number, start: Date, min: number | null, extra: Partial<ReportInput['incidents'][number]> = {}) => ({
  id,
  serviceId: 100,
  kind: 'DOWN' as const,
  firstFailureAt: start,
  recoveredAt: min === null ? null : plus(start, min),
  upgradedAt: null,
  ...extra,
});

const top = (id: number, start: Date, min: number | null, extra: Partial<ReportInput['topIncidents'][number]> = {}) => ({
  id,
  serviceId: 100,
  serverId: 10,
  kind: 'DOWN' as const,
  serviceNames: ['Web'],
  firstFailureAt: start,
  recoveredAt: min === null ? null : plus(start, min),
  ticketId: null,
  ticketCode: null,
  evidence: [],
  ...extra,
});

describe('computeAvailabilityReport', () => {
  it('un DOWN de 60 min en un mes de 30 días da 99.861', () => {
    const start = at('2026-09-10T15:00:00.000Z');
    const r = computeAvailabilityReport(base({ incidents: [down(1, start, 60)], topIncidents: [top(1, start, 60)] }));
    expect(r.services[0].availabilityPct).toBe(99.861);
    expect(r.services[0].downMinutes).toBe(60);
    expect(r.totals.availabilityPct).toBe(99.861);
    expect(r.totals.downMinutes).toBe(60);
    expect(r.totals.incidents).toBe(1);
    expect(r.services[0].incidents).toBe(1);
    expect(r.version).toBe(1);
    expect(r.from).toBe(FROM.toISOString());
    expect(r.to).toBe(TO.toISOString());
  });

  it('un DOWN del 30 a las 23:30 al 1 siguiente a las 00:30 (Lima) cuenta 30 min', () => {
    // 30-09 23:30 Lima = 01-10 04:30 UTC.
    const start = at('2026-10-01T04:30:00.000Z');
    const r = computeAvailabilityReport(base({ incidents: [down(1, start, 60)], topIncidents: [top(1, start, 60)] }));
    expect(r.services[0].downMinutes).toBe(30);
    expect(r.incidents[0].minutesInMonth).toBe(30);
    expect(r.services[0].availabilityPct).toBe(Math.round((1 - 30 / 43200) * 100_000) / 1000);
  });

  it('un incidente abierto en un mes parcial cuenta hasta now', () => {
    const now = at('2026-09-15T05:00:00.000Z'); // 14 días exactos
    const start = plus(now, -90);
    const r = computeAvailabilityReport(
      base({ to: now, partial: true, incidents: [down(1, start, null)], topIncidents: [top(1, start, null)] }),
    );
    expect(r.partial).toBe(true);
    expect(r.services[0].downMinutes).toBe(90);
    expect(r.incidents[0].recoveredAt).toBeNull();
    expect(r.incidents[0].minutesInMonth).toBe(90);
    const T = 14 * 1440;
    expect(r.services[0].availabilityPct).toBe(Math.round((1 - 90 / T) * 100_000) / 1000);
  });

  it('un ROUTE de 40 min que pasó a DOWN a los 10 min: ROUTE 10, DOWN 30, acceso desde Perú sobre 40', () => {
    const start = at('2026-09-05T12:00:00.000Z');
    const inc = down(1, start, 40, { upgradedAt: plus(start, 10) });
    const r = computeAvailabilityReport(base({ incidents: [inc], topIncidents: [top(1, start, 40)] }));
    const s = r.services[0];
    expect(s.routeMinutes).toBe(10);
    expect(s.downMinutes).toBe(30);
    expect(s.availabilityPct).toBe(Math.round((1 - 30 / 43200) * 100_000) / 1000);
    expect(s.peruAccessPct).toBe(Math.round((1 - 40 / 43200) * 100_000) / 1000);
    expect(r.totals.routeMinutes).toBe(10);
    expect(r.totals.peruAccessPct).toBe(s.peruAccessPct);
  });

  it('una ventana de servidor de 2 h superpuesta 30 min con un DOWN de 60 min: DOWN 30 y T = 43200 − 120', () => {
    const start = at('2026-09-12T10:00:00.000Z');
    const r = computeAvailabilityReport(
      base({
        incidents: [down(1, start, 60)],
        topIncidents: [top(1, start, 60)],
        maintenance: [
          { id: 7, serverId: 10, serviceId: null, startsAt: plus(start, 30), endsAt: plus(start, 150), reason: 'Parche' },
        ],
      }),
    );
    const s = r.services[0];
    expect(s.downMinutes).toBe(30);
    expect(s.maintenanceMinutes).toBe(120);
    expect(s.availabilityPct).toBe(Math.round((1 - 30 / (43200 - 120)) * 100_000) / 1000);
    expect(r.incidents[0].minutesInMonth).toBe(30);
    expect(r.maintenance).toEqual([
      {
        targetLabel: 'SRV-A',
        startsAt: plus(start, 30).toISOString(),
        endsAt: plus(start, 150).toISOString(),
        reason: 'Parche',
        minutesInMonth: 120,
      },
    ]);
  });

  it('una ventana que cubre todo el mes da cifras null', () => {
    const start = at('2026-09-12T10:00:00.000Z');
    const r = computeAvailabilityReport(
      base({
        incidents: [down(1, start, 60)],
        topIncidents: [top(1, start, 60)],
        maintenance: [{ id: 7, serverId: null, serviceId: 100, startsAt: plus(FROM, -60), endsAt: plus(TO, 60), reason: 'Migración' }],
      }),
    );
    expect(r.services[0].availabilityPct).toBeNull();
    expect(r.services[0].peruAccessPct).toBeNull();
    expect(r.services[0].downMinutes).toBe(0);
    expect(r.totals.availabilityPct).toBeNull();
    expect(r.totals.peruAccessPct).toBeNull();
    expect(r.totals.mttrMinutes).toBeNull();
    expect(r.maintenance[0].minutesInMonth).toBe(43200);
    expect(r.maintenance[0].targetLabel).toBe('SRV-A · Web');
  });

  it('MTTR: promedio de los incidentes de primer nivel cerrados (20 y 40 → 30); el abierto se excluye', () => {
    const a = at('2026-09-02T10:00:00.000Z');
    const b = at('2026-09-03T10:00:00.000Z');
    const c = at('2026-09-30T20:00:00.000Z');
    const r = computeAvailabilityReport(
      base({
        incidents: [down(1, a, 20), down(2, b, 40), down(3, c, null)],
        topIncidents: [top(1, a, 20), top(2, b, 40), top(3, c, null)],
      }),
    );
    expect(r.totals.mttrMinutes).toBe(30);
    expect(r.totals.incidents).toBe(3);
  });

  it('dos clientes: el informe del A no contiene nada del B', () => {
    const start = at('2026-09-10T15:00:00.000Z');
    const r = computeAvailabilityReport(
      base({
        incidents: [down(1, start, 60), down(2, start, 600, { serviceId: 200 })],
        topIncidents: [
          top(1, start, 60),
          top(2, start, 600, { serviceId: 200, serverId: 20, serviceNames: ['Web B'], ticketCode: 'B-1', evidence: [{ id: 9, origin: 'OFICINA', capturedAt: start, fileName: 'b.txt' }] }),
        ],
        maintenance: [{ id: 8, serverId: 20, serviceId: null, startsAt: start, endsAt: plus(start, 60), reason: 'Del cliente B' }],
        rollups: [{ serviceId: 200, probeId: 1, date: '2026-09-10', expected: 10, executed: 10, latencyHist: [10] }],
        agentRollups: [{ serverId: 20, date: '2026-09-10', cpuHist: [5], ramHist: [5], disksClose: [{ name: 'C:', totalBytes: 10, freeBytes: 5 }] }],
      }),
    );
    const json = JSON.stringify(r);
    expect(json).not.toContain('Web B');
    expect(json).not.toContain('B-1');
    expect(json).not.toContain('b.txt');
    expect(json).not.toContain('Del cliente B');
    expect(r.incidents.map((i) => i.incidentId)).toEqual([1]);
    expect(r.services.map((s) => s.serviceId)).toEqual([100]);
    expect(r.services[0].coverage.office).toBeNull();
    expect(r.servers.map((s) => s.serverName)).toEqual(['SRV-A']);
    expect(r.totals.downMinutes).toBe(60);
  });

  it('latencia y cobertura por tipo de sonda; sonda sin resúmenes → null', () => {
    const hist = (v: number) => {
      const h = new Array(LATENCY_BUCKETS_MS.length).fill(0);
      h[LATENCY_BUCKETS_MS.indexOf(v)] = 10;
      return h;
    };
    const r = computeAvailabilityReport(
      base({
        rollups: [
          { serviceId: 100, probeId: 1, date: '2026-09-01', expected: 360, executed: 359, latencyHist: hist(50) },
          { serviceId: 100, probeId: 1, date: '2026-09-02', expected: 360, executed: 360, latencyHist: hist(50) },
        ],
      }),
    );
    const s = r.services[0];
    expect(s.latency.office).toEqual({ p50: 75, p95: 75 });
    expect(s.coverage.office).toBe(Math.round((719 / 720) * 100_000) / 1000);
    expect(s.latency.datacenter).toEqual({ p50: null, p95: null });
    expect(s.coverage.datacenter).toBeNull();
  });

  it('ventanas sin datos: une los huecos contiguos de la misma sonda y causa en días seguidos', () => {
    const r = computeAvailabilityReport(
      base({
        gaps: [
          { probeId: 1, cause: 'OFFICE_OUTAGE', startedAt: at('2026-09-04T03:00:00.000Z'), endedAt: at('2026-09-04T05:00:00.000Z'), date: '2026-09-03' },
          { probeId: 1, cause: 'OFFICE_OUTAGE', startedAt: at('2026-09-04T05:00:00.000Z'), endedAt: at('2026-09-04T06:30:00.000Z'), date: '2026-09-04' },
          { probeId: 1, cause: 'PROBE_SILENT', startedAt: at('2026-09-04T06:30:00.000Z'), endedAt: at('2026-09-04T06:45:00.000Z'), date: '2026-09-04' },
          { probeId: 2, cause: 'PROBE_SILENT', startedAt: at('2026-09-04T03:00:00.000Z'), endedAt: at('2026-09-04T03:20:00.000Z'), date: '2026-09-03' },
        ],
      }),
    );
    expect(r.noDataWindows).toEqual([
      { probeCode: 'oficina-01', cause: 'OFFICE_OUTAGE', startedAt: '2026-09-04T03:00:00.000Z', endedAt: '2026-09-04T06:30:00.000Z', minutes: 210 },
      { probeCode: 'kubo-01', cause: 'PROBE_SILENT', startedAt: '2026-09-04T03:00:00.000Z', endedAt: '2026-09-04T03:20:00.000Z', minutes: 20 },
      { probeCode: 'oficina-01', cause: 'PROBE_SILENT', startedAt: '2026-09-04T06:30:00.000Z', endedAt: '2026-09-04T06:45:00.000Z', minutes: 15 },
    ]);
  });

  it('recursos del servidor: P95 de CPU y RAM de los histogramas sumados y discos del último día', () => {
    const h = (bucket: number, n = 100) => {
      const x = new Array(PERCENT_BUCKETS.length).fill(0);
      x[PERCENT_BUCKETS.indexOf(bucket)] = n;
      return x;
    };
    const r = computeAvailabilityReport(
      base({
        agentRollups: [
          { serverId: 10, date: '2026-09-02', cpuHist: h(20), ramHist: h(60), disksClose: [{ name: 'C:', totalBytes: 100, freeBytes: 90 }] },
          { serverId: 10, date: '2026-09-01', cpuHist: h(40, 3), ramHist: h(60), disksClose: [{ name: 'C:', totalBytes: 100, freeBytes: 99 }] },
        ],
      }),
    );
    expect(r.servers).toEqual([
      { serverName: 'SRV-A', cpuP95: 25, ramP95: 65, disksAtClose: [{ name: 'C:', freePct: 90 }] },
    ]);
  });

  it('servidor sin agente: cifras null y sin discos', () => {
    const r = computeAvailabilityReport(base());
    expect(r.servers).toEqual([{ serverName: 'SRV-A', cpuP95: null, ramP95: null, disksAtClose: [] }]);
    expect(r.totals.mttrMinutes).toBeNull();
    expect(r.totals.availabilityPct).toBe(100);
  });

  it('el criterio incluye las fórmulas y la frase de los minutos sin datos', () => {
    const r = computeAvailabilityReport(base());
    expect(r.criteria).toContain('Los minutos sin datos desde la oficina no cuentan como caída.');
    expect(r.criteria.join(' ')).toMatch(/1 − DOWN ÷ T/);
  });
});
