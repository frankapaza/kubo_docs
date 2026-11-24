import { combineStatus, ProbeView } from './combined-state';

const NOW = new Date('2026-11-23T15:00:00Z');
const INTERVAL = 5 * 60_000;
const fresh = (state: ProbeView['state'] = 'OK'): ProbeView => ({
  state,
  lastCheckAt: new Date(NOW.getTime() - 60_000),
  lastLatencyMs: 40,
});
const stale = (): ProbeView => ({ state: 'OK', lastCheckAt: new Date(NOW.getTime() - 3 * INTERVAL - 1), lastLatencyMs: 40 });

describe('combineStatus', () => {
  it('incidente DOWN -> DOWN, aunque las sondas digan OK', () => {
    expect(combineStatus(fresh(), fresh(), 'DOWN', NOW, INTERVAL)).toBe('DOWN');
  });
  it('incidente ROUTE -> ROUTE', () => {
    expect(combineStatus(fresh('FAILED'), fresh(), 'ROUTE', NOW, INTERVAL)).toBe('ROUTE');
  });
  it('incidente DEGRADED con sondas OK -> DEGRADED', () => {
    expect(combineStatus(fresh(), fresh(), 'DEGRADED', NOW, INTERVAL)).toBe('DEGRADED');
  });
  it('sonda VERIFYING sin incidente -> VERIFYING', () => {
    expect(combineStatus(fresh('VERIFYING'), fresh(), null, NOW, INTERVAL)).toBe('VERIFYING');
  });
  it('sonda FAILED sin incidente -> VERIFYING', () => {
    expect(combineStatus(fresh(), fresh('FAILED'), null, NOW, INTERVAL)).toBe('VERIFYING');
  });
  it('VERIFYING gana a DEGRADED', () => {
    expect(combineStatus(fresh('DEGRADED'), fresh('VERIFYING'), null, NOW, INTERVAL)).toBe('VERIFYING');
  });
  it('sonda DEGRADED -> DEGRADED', () => {
    expect(combineStatus(fresh('DEGRADED'), fresh(), null, NOW, INTERVAL)).toBe('DEGRADED');
  });
  it('las dos sin datos (null) -> NO_DATA', () => {
    expect(combineStatus(null, null, null, NOW, INTERVAL)).toBe('NO_DATA');
  });
  it('las dos sin comprobación en 3 franjas -> NO_DATA', () => {
    expect(combineStatus(stale(), stale(), null, NOW, INTERVAL)).toBe('NO_DATA');
  });
  it('una sonda al día basta para no ser NO_DATA', () => {
    expect(combineStatus(stale(), fresh(), null, NOW, INTERVAL)).toBe('OK');
  });
  it('justo en el límite de 3 franjas todavía es OK', () => {
    const edge: ProbeView = { state: 'OK', lastCheckAt: new Date(NOW.getTime() - 3 * INTERVAL), lastLatencyMs: 1 };
    expect(combineStatus(edge, edge, null, NOW, INTERVAL)).toBe('OK');
  });
  it('todo bien -> OK', () => {
    expect(combineStatus(fresh(), fresh(), null, NOW, INTERVAL)).toBe('OK');
  });
});
