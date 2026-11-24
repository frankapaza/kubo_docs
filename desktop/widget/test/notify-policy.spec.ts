import { engineDownToast, EngineDownTracker, isAllowedUrl, nextCursorState, toastsFor } from '../src/shared/notify-policy';
import type { EngineEvent } from '../src/shared/types';

const CENTRAL = 'https://central.example.com';
const T0 = Date.parse('2026-11-24T15:30:00Z'); // 10:30 Lima

function ev(p: Partial<EngineEvent>): EngineEvent {
  return {
    id: 1, at: '2026-11-24T15:30:00Z', kind: 'INCIDENT_OPENED', incidentKey: 7, incidentKind: 'DOWN',
    serverName: 'srv-1', serviceNames: ['API'], criticality: 'HIGH', ticketCode: null, notify: true, ...p,
  };
}

describe('toastsFor', () => {
  it('OPENED HIGH gives one toast with the incident url', () => {
    const t = toastsFor([ev({ ticketCode: 'T-12' })], CENTRAL, new Map(), T0);
    expect(t).toHaveLength(1);
    expect(t[0].title).toBe('Caída: API');
    expect(t[0].url).toBe(`${CENTRAL}/monitoreo/incidentes/7`);
    expect(t[0].body).toBe('API · T-12 · 10:30');
    expect(t[0].dedupeKey).toBe('INCIDENT_OPENED:7');
  });

  it('ignores events with notify false', () => {
    const events = [ev({ notify: false, criticality: 'MEDIUM' }), ev({ id: 2, kind: 'DEGRADED_STARTED', incidentKind: 'DEGRADED', notify: false })];
    expect(toastsFor(events, CENTRAL, new Map(), T0)).toEqual([]);
  });

  it('dedupes within 2 min and emits again after 3 min', () => {
    const recent = new Map<string, number>();
    expect(toastsFor([ev({})], CENTRAL, recent, T0)).toHaveLength(1);
    expect(toastsFor([ev({ id: 2 })], CENTRAL, recent, T0 + 60_000)).toHaveLength(0);
    expect(toastsFor([ev({ id: 3 })], CENTRAL, recent, T0 + 180_000)).toHaveLength(1);
  });

  it('uses the server name for server incidents', () => {
    const t = toastsFor([ev({ serviceNames: ['API', 'Web'] })], CENTRAL, new Map(), T0);
    expect(t[0].title).toBe('Caída: srv-1');
    expect(t[0].body).toBe('API, Web · 10:30');
  });

  it('titles per kind', () => {
    const t = (e: Partial<EngineEvent>) => toastsFor([ev(e)], CENTRAL, new Map(), T0)[0];
    expect(t({ incidentKind: 'ROUTE' }).title).toBe('Sin acceso desde Perú: API');
    expect(t({ kind: 'INCIDENT_UPGRADED' }).title).toBe('Caída: API');
    expect(t({ kind: 'INCIDENT_RECOVERED' }).title).toBe('Recuperado: API');
    expect(t({ kind: 'CENTRAL_UNREACHABLE', incidentKey: null, incidentKind: null, serviceNames: [] }).title).toBe('La central no responde');
    expect(t({ kind: 'CENTRAL_REJECTING', incidentKey: null, incidentKind: null, serviceNames: [] }).title).toBe('La central rechaza los envíos');
  });

  it('no toast for the engine-side notify:false of OFFICE_OUTAGE_ENDED, CENTRAL_BACK and a silent CENTRAL_UNREACHABLE', () => {
    const base: Partial<EngineEvent> = { incidentKey: null, incidentKind: null, serverName: null, serviceNames: [], criticality: null, notify: false };
    const events = [
      ev({ ...base, id: 1, kind: 'OFFICE_OUTAGE_ENDED' }),
      ev({ ...base, id: 2, kind: 'CENTRAL_BACK' }),
      ev({ ...base, id: 3, kind: 'CENTRAL_UNREACHABLE' }),
    ];
    expect(toastsFor(events, CENTRAL, new Map(), T0)).toEqual([]);
  });

  it('OFFICE_OUTAGE_STARTED gives one grouped toast pointing to the board', () => {
    const e = ev({ kind: 'OFFICE_OUTAGE_STARTED', incidentKey: null, incidentKind: null, serverName: null, serviceNames: ['A', 'B', 'C'], criticality: null });
    const t = toastsFor([e], CENTRAL, new Map(), T0);
    expect(t).toHaveLength(1);
    expect(t[0].title).toBe('Sin internet en la oficina');
    expect(t[0].url).toBe(`${CENTRAL}/monitoreo/estado`);
  });
});

describe('isAllowedUrl', () => {
  it('accepts same origin under /monitoreo/', () => {
    expect(isAllowedUrl(`${CENTRAL}/monitoreo/incidentes/7`, CENTRAL)).toBe(true);
    expect(isAllowedUrl(`${CENTRAL}/monitoreo/estado`, CENTRAL)).toBe(true);
  });
  it('rejects external, other paths, tricks and garbage', () => {
    expect(isAllowedUrl('https://evil.com/monitoreo/x', CENTRAL)).toBe(false);
    expect(isAllowedUrl(`${CENTRAL}.evil.com/monitoreo/x`, CENTRAL)).toBe(false);
    expect(isAllowedUrl(`${CENTRAL}/admin`, CENTRAL)).toBe(false);
    expect(isAllowedUrl(`${CENTRAL}/monitoreo`, CENTRAL)).toBe(false);
    expect(isAllowedUrl(`${CENTRAL}/monitoreo/../admin`, CENTRAL)).toBe(false);
    expect(isAllowedUrl('file:///c:/x', CENTRAL)).toBe(false);
    expect(isAllowedUrl('nope', CENTRAL)).toBe(false);
    expect(isAllowedUrl(`${CENTRAL}/monitoreo/x`, 'nope')).toBe(false);
  });
  it('rejects javascript: and URLs with userinfo', () => {
    expect(isAllowedUrl('javascript:alert(1)//monitoreo/', CENTRAL)).toBe(false);
    expect(isAllowedUrl('javascript://central.example.com/monitoreo/%0aalert(1)', CENTRAL)).toBe(false);
    expect(isAllowedUrl('https://user:pass@central.example.com/monitoreo/estado', CENTRAL)).toBe(false);
    expect(isAllowedUrl('https://user@central.example.com/monitoreo/estado', CENTRAL)).toBe(false);
    expect(isAllowedUrl('https://central.example.com@evil.com/monitoreo/estado', CENTRAL)).toBe(false);
  });
});

describe('nextCursorState', () => {
  const start = Date.parse('2026-11-24T15:00:00Z');
  it('resets when lastId < cursor and shows nothing from that response', () => {
    const r = nextCursorState(50, { lastId: 3, events: [ev({ id: 3 })] }, start);
    expect(r).toEqual({ cursor: 0, toast: [] });
  });
  it('drops events older than widget start and advances the cursor', () => {
    const old = ev({ id: 4, at: '2026-11-24T14:00:00Z' });
    const fresh = ev({ id: 5, at: '2026-11-24T15:10:00Z' });
    const r = nextCursorState(3, { lastId: 5, events: [old, fresh] }, start);
    expect(r.cursor).toBe(5);
    expect(r.toast).toEqual([fresh]);
  });
  it('keeps the cursor with no events', () => {
    expect(nextCursorState(9, { lastId: 9, events: [] }, start)).toEqual({ cursor: 9, toast: [] });
  });
});

describe('EngineDownTracker', () => {
  it('fires once after 3 consecutive down following ok (≈15 s), not from connecting, re-arms after ok', () => {
    const t = new EngineDownTracker();
    expect(t.update('connecting')).toBe(false);
    expect(t.update('down')).toBe(false);
    expect(t.update('down')).toBe(false);
    expect(t.update('down')).toBe(false);
    expect(t.update('ok')).toBe(false);
    expect(t.update('down')).toBe(false);
    expect(t.update('down')).toBe(false);
    expect(t.update('down')).toBe(true);
    expect(t.update('down')).toBe(false);
    expect(t.update('down')).toBe(false);
    expect(t.update('down')).toBe(false);
    expect(t.update('ok')).toBe(false);
    expect(t.update('down')).toBe(false);
    expect(t.update('down')).toBe(false);
    expect(t.update('down')).toBe(true);
  });

  it('a short blip (1–2 down between ok) never fires', () => {
    const t = new EngineDownTracker();
    const seq = ['ok', 'down', 'ok', 'down', 'down', 'ok', 'down', 'down', 'ok'] as const;
    expect(seq.map((k) => t.update(k))).toEqual(seq.map(() => false));
  });
  it('engineDownToast opens the board', () => {
    const x = engineDownToast(CENTRAL);
    expect(x.title).toBe('El motor no responde');
    expect(x.url).toBe(`${CENTRAL}/monitoreo/estado`);
  });
});
