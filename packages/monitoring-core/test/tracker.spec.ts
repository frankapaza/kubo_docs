import { ServiceProbeTracker } from '../src/tracker';
import type { CheckKind, CheckResult, ServiceTarget } from '../src/types';

const svc: ServiceTarget = { id: 1, protocol: 'TCP', target: 'h', port: 1, latencyThresholdMs: 100 };
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
let n = 0;
function res(kind: CheckKind, ok: boolean, at: number | string = T0, durationMs = 10): CheckResult {
  const iso = typeof at === 'number' ? new Date(at).toISOString() : at;
  return { id: `r${n++}`, serviceId: 1, kind, cycleAt: iso, startedAt: iso, durationMs, ok,
    errorCode: ok ? null : 'TIMEOUT', httpStatus: null, orderId: null };
}
const types = (s: { type: string }[]) => s.map((x) => x.type);

describe('ServiceProbeTracker', () => {
  it('fallo regular + dos reintentos fallidos confirman', () => {
    const t = new ServiceProbeTracker(svc);
    const a = t.onResult(res('REGULAR', false, T0));
    const b = t.onResult(res('RETRY', false, T0 + 30000));
    const c = t.onResult(res('RETRY', false, T0 + 60000));
    expect(types(a)).toEqual(['VERIFYING']);
    expect(b).toEqual([]);
    expect(types(c)).toEqual(['CONFIRMED_FAILURE']);
    expect(c[0].firstFailureAt).toBe(new Date(T0).toISOString());
    expect(c[0].serviceId).toBe(1);
    expect(t.state()).toBe('FAILED');
    expect(new Set([a[0].id, c[0].id]).size).toBe(2);
  });

  it('pendingRetryAt', () => {
    const t = new ServiceProbeTracker(svc);
    expect(t.pendingRetryAt()).toBeNull();
    t.onResult(res('REGULAR', false, T0));
    expect(t.pendingRetryAt()?.getTime()).toBe(T0 + 30000);
    t.onResult(res('RETRY', false, T0 + 30000));
    expect(t.pendingRetryAt()?.getTime()).toBe(T0 + 60000);
    t.onResult(res('RETRY', false, T0 + 60000));
    expect(t.pendingRetryAt()).toBeNull();
  });

  it('reintento correcto es transitorio', () => {
    const t = new ServiceProbeTracker(svc);
    t.onResult(res('REGULAR', false, T0));
    const s = t.onResult(res('RETRY', true, T0 + 30000));
    expect(types(s)).toEqual(['TRANSIENT_FAILURE']);
    expect(t.state()).toBe('OK');
    expect(t.pendingRetryAt()).toBeNull();
  });

  it('RETRY fuera de VERIFYING se ignora', () => {
    const t = new ServiceProbeTracker(svc);
    expect(t.onResult(res('RETRY', false))).toEqual([]);
    expect(t.state()).toBe('OK');
  });

  function failed() {
    const t = new ServiceProbeTracker(svc);
    t.onResult(res('REGULAR', false, T0));
    t.onResult(res('RETRY', false, T0 + 30000));
    t.onResult(res('RETRY', false, T0 + 60000));
    return t;
  }

  it('recupera con dos correctos seguidos', () => {
    const t = failed();
    expect(t.onResult(res('REGULAR', true))).toEqual([]);
    expect(t.state()).toBe('FAILED');
    expect(types(t.onResult(res('MANUAL', true)))).toEqual(['RECOVERED']);
    expect(t.state()).toBe('OK');
  });

  it('correcto, fallo, correcto no recupera', () => {
    const t = failed();
    t.onResult(res('REGULAR', true));
    t.onResult(res('REGULAR', false));
    expect(t.onResult(res('REGULAR', true))).toEqual([]);
    expect(t.state()).toBe('FAILED');
  });

  it('degradación y limpieza', () => {
    const t = new ServiceProbeTracker(svc, { trackDegradation: true });
    expect(t.onResult(res('REGULAR', true, T0, 500))).toEqual([]);
    expect(t.onResult(res('REGULAR', true, T0, 500))).toEqual([]);
    expect(types(t.onResult(res('REGULAR', true, T0, 500)))).toEqual(['DEGRADED']);
    expect(t.state()).toBe('DEGRADED');
    expect(t.onResult(res('REGULAR', true, T0, 10))).toEqual([]);
    expect(types(t.onResult(res('REGULAR', true, T0, 10)))).toEqual(['DEGRADATION_CLEARED']);
    expect(t.state()).toBe('OK');
  });

  it('sin trackDegradation nunca degrada', () => {
    const t = new ServiceProbeTracker(svc, { trackDegradation: false });
    for (let i = 0; i < 5; i++) expect(t.onResult(res('REGULAR', true, T0, 500))).toEqual([]);
    expect(t.state()).toBe('OK');
  });

  it('2 lentos y 1 rápido no degrada', () => {
    const t = new ServiceProbeTracker(svc, { trackDegradation: true });
    t.onResult(res('REGULAR', true, T0, 500));
    t.onResult(res('REGULAR', true, T0, 500));
    t.onResult(res('REGULAR', true, T0, 10));
    expect(t.onResult(res('REGULAR', true, T0, 500))).toEqual([]);
    expect(t.state()).toBe('OK');
  });

  it('CROSS fallido en OK no emite VERIFYING', () => {
    const t = new ServiceProbeTracker(svc);
    expect(t.onResult(res('CROSS', false))).toEqual([]);
    expect(t.onResult(res('MANUAL', false))).toEqual([]);
    expect(t.state()).toBe('OK');
  });
});
