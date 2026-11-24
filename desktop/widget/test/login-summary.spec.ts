import { summarize } from '../src/shared/login-summary';
import type { EngineEvent } from '../src/shared/types';
import type { WidgetModel, WidgetRow } from '../src/shared/widget-model';

const SINCE = '2026-11-24T03:00:00Z';

function ev(p: Partial<EngineEvent>): EngineEvent {
  return {
    id: 1, at: '2026-11-24T05:00:00Z', kind: 'INCIDENT_OPENED', incidentKey: 7, incidentKind: 'DOWN',
    serverName: 'srv-1', serviceNames: ['API'], criticality: 'HIGH', ticketCode: null, notify: true, ...p,
  };
}

const ROW: WidgetRow = { key: 's:1', tone: 'red', title: 'API', detail: 'Perú ✕ · Servidor ✕', incidentId: 7, children: [] };
const model = (rows: WidgetRow[]): WidgetModel => ({ tone: rows.length ? 'red' : 'ok', headline: '', time: '08:00', rows, expanded: rows.length > 0 });

describe('summarize', () => {
  it('returns null without events', () => {
    expect(summarize([], SINCE, model([ROW]))).toBeNull();
  });

  it('counts what happened since the last session, in Spanish', () => {
    const events = [
      ev({ id: 1, incidentKey: 7, serviceNames: ['API'] }),
      ev({ id: 2, incidentKey: 8, serviceNames: ['Web'], incidentKind: 'ROUTE', at: '2026-11-24T06:00:00Z' }),
      ev({ id: 3, kind: 'INCIDENT_RECOVERED', incidentKey: 8, serviceNames: ['Web'], at: '2026-11-24T07:00:00Z' }),
      ev({ id: 4, kind: 'OFFICE_OUTAGE_STARTED', incidentKey: null, incidentKind: null, serverName: null, serviceNames: [], criticality: null }),
    ];
    const s = summarize(events, SINCE, model([ROW]))!;
    expect(s).not.toBeNull();
    expect([s.opened, s.recovered, s.officeOutages, s.centralOutages]).toEqual([2, 1, 1, 0]);
    expect(s.stillActive).toEqual([ROW]);
    expect(s.lines).toEqual([
      '2 incidentes abiertos: API, Web',
      '1 recuperado: Web',
      '1 corte de internet en la oficina',
      'Sigue activo: API',
    ]);
  });

  it('ignores events before since', () => {
    const events = [ev({ id: 1, at: '2026-11-24T02:59:59Z' }), ev({ id: 2, kind: 'CENTRAL_UNREACHABLE', at: '2026-11-24T03:00:00Z' })];
    expect(summarize(events, SINCE, model([]))).toBeNull();
    const s = summarize([...events, ev({ id: 3, kind: 'CENTRAL_UNREACHABLE', at: '2026-11-24T04:00:00Z' })], SINCE, model([]))!;
    expect([s.opened, s.centralOutages]).toEqual([0, 1]);
    expect(s.lines).toEqual(['La central dejó de responder 1 vez', 'Ahora todo está operativo']);
  });

  it('returns null on the first run (no previous session)', () => {
    expect(summarize([ev({})], null, model([]))).toBeNull();
  });

  it('ignores degradation-only events', () => {
    const events = [ev({ kind: 'DEGRADED_STARTED', incidentKind: 'DEGRADED', notify: false })];
    expect(summarize(events, SINCE, model([]))).toBeNull();
  });

  it('does not count a CENTRAL_UNREACHABLE inside an office outage window (one outage, one line)', () => {
    const base: Partial<EngineEvent> = { incidentKey: null, incidentKind: null, serverName: null, serviceNames: [], criticality: null };
    const events = [
      ev({ ...base, id: 1, kind: 'OFFICE_OUTAGE_STARTED', at: '2026-11-24T05:00:00Z' }),
      ev({ ...base, id: 2, kind: 'CENTRAL_UNREACHABLE', notify: false, at: '2026-11-24T05:00:01Z' }),
      ev({ ...base, id: 3, kind: 'CENTRAL_BACK', notify: false, at: '2026-11-24T05:20:00Z' }),
      ev({ ...base, id: 4, kind: 'OFFICE_OUTAGE_ENDED', notify: false, at: '2026-11-24T05:25:00Z' }),
      // Fuera de la ventana sí cuenta.
      ev({ ...base, id: 5, kind: 'CENTRAL_UNREACHABLE', at: '2026-11-24T06:00:00Z' }),
    ];
    const s = summarize(events, SINCE, model([]))!;
    expect([s.officeOutages, s.centralOutages]).toEqual([1, 1]);
    expect(s.lines).toEqual(['1 corte de internet en la oficina', 'La central dejó de responder 1 vez', 'Ahora todo está operativo']);
  });

  it('an office outage that started before since still hides the CENTRAL_UNREACHABLE inside it', () => {
    const base: Partial<EngineEvent> = { incidentKey: null, incidentKind: null, serverName: null, serviceNames: [], criticality: null };
    const events = [
      ev({ ...base, id: 1, kind: 'OFFICE_OUTAGE_STARTED', at: '2026-11-24T02:00:00Z' }),
      ev({ ...base, id: 2, kind: 'CENTRAL_UNREACHABLE', notify: false, at: '2026-11-24T04:00:00Z' }),
    ];
    expect(summarize(events, SINCE, model([]))).toBeNull();
  });

  it('counts a recovered incident once even if it recovered twice', () => {
    const events = [
      ev({ id: 1, kind: 'INCIDENT_RECOVERED', incidentKey: 7, at: '2026-11-24T05:00:00Z' }),
      ev({ id: 2, kind: 'INCIDENT_RECOVERED', incidentKey: 7, at: '2026-11-24T06:00:00Z' }),
      ev({ id: 3, kind: 'INCIDENT_RECOVERED', incidentKey: 9, serviceNames: ['Web'], at: '2026-11-24T07:00:00Z' }),
    ];
    const s = summarize(events, SINCE, model([]))!;
    expect(s.recovered).toBe(2);
    expect(s.lines[0]).toBe('2 recuperados: API, Web');
  });

  it('counts a reopened incident once', () => {
    const events = [
      ev({ id: 1, incidentKey: 7 }),
      ev({ id: 2, kind: 'INCIDENT_RECOVERED', incidentKey: 7, at: '2026-11-24T06:00:00Z' }),
      ev({ id: 3, incidentKey: 7, at: '2026-11-24T07:00:00Z' }),
    ];
    const s = summarize(events, SINCE, model([ROW]))!;
    expect([s.opened, s.recovered]).toEqual([1, 1]);
    expect(s.lines[0]).toBe('1 incidente abierto: API');
  });
});
