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
    const all = [];
    for (let i = 0; i < 5; i++) all.push(...t.onResult(res('REGULAR', true, T0, 500)));
    expect(types(all)).toEqual(['STATE_SYNC']); // solo la sincronización de arranque
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

  function degraded() {
    const t = new ServiceProbeTracker(svc, { trackDegradation: true });
    for (let i = 0; i < 3; i++) t.onResult(res('REGULAR', true, T0, 500));
    return t;
  }

  it('DEGRADED + fallo regular + reintento correcto: CLEARED+VERIFYING y luego TRANSIENT', () => {
    const t = degraded();
    expect(t.state()).toBe('DEGRADED');
    expect(types(t.onResult(res('REGULAR', false, T0)))).toEqual(['DEGRADATION_CLEARED', 'VERIFYING']);
    expect(types(t.onResult(res('RETRY', true, T0 + 30000)))).toEqual(['TRANSIENT_FAILURE']);
    expect(t.state()).toBe('OK');
  });

  it('DEGRADED + fallo + 2 reintentos fallidos + 2 correctos: sin segundo CLEARED', () => {
    const t = degraded();
    const all = [
      ...t.onResult(res('REGULAR', false, T0)),
      ...t.onResult(res('RETRY', false, T0 + 30000)),
      ...t.onResult(res('RETRY', false, T0 + 60000)),
      ...t.onResult(res('REGULAR', true)),
      ...t.onResult(res('REGULAR', true)),
    ];
    expect(types(all)).toEqual(['DEGRADATION_CLEARED', 'VERIFYING', 'CONFIRMED_FAILURE', 'RECOVERED']);
  });

  describe('sincronización de arranque (STATE_SYNC)', () => {
    it('tras arrancar, dos correctos rápidos seguidos emiten un único STATE_SYNC con serviceId y at', () => {
      const t = new ServiceProbeTracker(svc);
      expect(t.onResult(res('REGULAR', true, T0))).toEqual([]);
      const s = t.onResult(res('REGULAR', true, T0 + 300000));
      expect(types(s)).toEqual(['STATE_SYNC']);
      expect(s[0]).toMatchObject({ serviceId: 1, at: new Date(T0 + 300000).toISOString(), firstFailureAt: null });
      for (let i = 0; i < 4; i++) expect(t.onResult(res('REGULAR', true))).toEqual([]);
    });

    it('MANUAL, CROSS y fallos no cuentan; un fallo regular sincroniza por la vía normal (VERIFYING)', () => {
      const t = new ServiceProbeTracker(svc);
      expect(t.onResult(res('MANUAL', true))).toEqual([]);
      expect(t.onResult(res('CROSS', true))).toEqual([]);
      expect(t.onResult(res('REGULAR', true))).toEqual([]);
      expect(types(t.onResult(res('REGULAR', false, T0)))).toEqual(['VERIFYING']);
      expect(types(t.onResult(res('RETRY', true, T0 + 30000)))).toEqual(['TRANSIENT_FAILURE']);
      // Ya sincronizado: los correctos siguientes no emiten nada.
      expect([...t.onResult(res('REGULAR', true)), ...t.onResult(res('REGULAR', true))]).toEqual([]);
    });

    it('con degradación: los lentos no sincronizan como OK; tres lentos emiten DEGRADED (que sincroniza)', () => {
      const t = new ServiceProbeTracker(svc, { trackDegradation: true });
      expect(t.onResult(res('REGULAR', true, T0, 10))).toEqual([]);
      expect(t.onResult(res('REGULAR', true, T0, 500))).toEqual([]);
      expect(t.onResult(res('REGULAR', true, T0, 10))).toEqual([]);
      expect(t.onResult(res('REGULAR', true, T0, 500))).toEqual([]);
      expect(t.onResult(res('REGULAR', true, T0, 500))).toEqual([]);
      expect(types(t.onResult(res('REGULAR', true, T0, 500)))).toEqual(['DEGRADED']);
      expect(t.onResult(res('REGULAR', true, T0, 10))).toEqual([]);
      expect(types(t.onResult(res('REGULAR', true, T0, 10)))).toEqual(['DEGRADATION_CLEARED']);
    });

    it('sin trackDegradation un correcto lento cuenta para la sincronización', () => {
      const t = new ServiceProbeTracker(svc, { trackDegradation: false });
      t.onResult(res('REGULAR', true, T0, 500));
      expect(types(t.onResult(res('REGULAR', true, T0, 500)))).toEqual(['STATE_SYNC']);
    });
  });
});

describe('ServiceProbeTracker: servicios con intervalo propio (pings cada minuto)', () => {
  it('no abren degradación por pings lentos: eso lo juzga la revisión por hora', () => {
    const t = new ServiceProbeTracker({ ...svc, intervalMin: 1 });
    const out = [1, 2, 3, 4, 5].flatMap((i) => t.onResult(res('REGULAR', true, T0 + i * 60_000, 500)));
    expect(types(out)).not.toContain('DEGRADED');
    expect(t.state()).toBe('OK');
  });

  it('si ya estaba degradado y pasa a intervalo propio, la próxima prueba la cierra', () => {
    const target = { ...svc };
    const t = new ServiceProbeTracker(target);
    [1, 2, 3, 4, 5].forEach((i) => t.onResult(res('REGULAR', true, T0 + i * 60_000, 500)));
    expect(t.state()).toBe('DEGRADED');
    Object.assign(target, { intervalMin: 1 });
    expect(types(t.onResult(res('REGULAR', true, T0 + 10 * 60_000, 500)))).toEqual(['DEGRADATION_CLEARED']);
    expect(t.state()).toBe('OK');
  });
});
