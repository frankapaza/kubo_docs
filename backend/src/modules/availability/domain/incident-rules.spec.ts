import {
  CROSS_TIMEOUT_MS,
  formatDuration,
  groupDecision,
  GROUPING_WINDOW_MS,
  recoveryCloses,
  reopenCandidate,
  REOPEN_WINDOW_MS,
} from './incident-rules';

const T0 = new Date('2026-11-23T15:00:00.000Z');
const plus = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

describe('constantes', () => {
  it('ventanas de la spec', () => {
    expect(GROUPING_WINDOW_MS).toBe(180_000);
    expect(REOPEN_WINDOW_MS).toBe(1_800_000);
    expect(CROSS_TIMEOUT_MS).toBe(120_000);
  });
});

describe('groupDecision', () => {
  it('segundo servicio a los 2 min -> CREATE_PARENT con el hermano', () => {
    expect(groupDecision(plus(2 * MIN), [{ incidentId: 7, confirmedAt: T0, parentId: null }], null)).toEqual({
      action: 'CREATE_PARENT',
      siblingIds: [7],
    });
  });

  it('segundo servicio a los 4 min -> ALONE', () => {
    expect(groupDecision(plus(4 * MIN), [{ incidentId: 7, confirmedAt: T0, parentId: null }], null)).toEqual({
      action: 'ALONE',
    });
  });

  it('con incidente de servidor abierto -> JOIN_PARENT', () => {
    expect(groupDecision(plus(20 * MIN), [{ incidentId: 7, confirmedAt: T0, parentId: 9 }], 9)).toEqual({
      action: 'JOIN_PARENT',
      parentId: 9,
    });
  });

  it('sin hermanos -> ALONE', () => {
    expect(groupDecision(T0, [], null)).toEqual({ action: 'ALONE' });
  });

  it('solo agrupa hermanos sueltos dentro de la ventana', () => {
    const res = groupDecision(
      plus(3 * MIN),
      [
        { incidentId: 1, confirmedAt: T0, parentId: null },
        { incidentId: 2, confirmedAt: plus(-1 * MIN), parentId: null },
        { incidentId: 3, confirmedAt: plus(2 * MIN), parentId: 44 },
      ],
      null,
    );
    expect(res).toEqual({ action: 'CREATE_PARENT', siblingIds: [1] });
  });
});

describe('reopenCandidate', () => {
  const closed = (minutesAgo: number, over: Partial<{ kind: string; closeReason: string }> = {}) => ({
    id: 5,
    kind: 'DOWN',
    recoveredAt: plus(-minutesAgo * MIN),
    closeReason: 'RECOVERED',
    ...over,
  });

  it('cerrado hace 29 min -> id', () => {
    expect(reopenCandidate(closed(29), T0)).toBe(5);
  });

  it('cerrado hace 31 min -> null', () => {
    expect(reopenCandidate(closed(31), T0)).toBeNull();
  });

  it('cerrado por SERVICE_PAUSED -> null', () => {
    expect(reopenCandidate(closed(5, { closeReason: 'SERVICE_PAUSED' }), T0)).toBeNull();
  });

  it('un DEGRADED no se reabre como caída', () => {
    expect(reopenCandidate(closed(5, { kind: 'DEGRADED' }), T0)).toBeNull();
  });

  it('ROUTE reciente -> id; sin cerrado -> null', () => {
    expect(reopenCandidate(closed(10, { kind: 'ROUTE' }), T0)).toBe(5);
    expect(reopenCandidate(null, T0)).toBeNull();
  });
});

describe('recoveryCloses', () => {
  it('DOWN con oficina OK y servidor FAILED -> false', () => {
    expect(recoveryCloses('DOWN', 'OK', 'FAILED')).toBe(false);
  });

  it('DOWN con las dos OK -> true', () => {
    expect(recoveryCloses('DOWN', 'OK', 'OK')).toBe(true);
  });

  it('DOWN con la oficina sin datos (caída de oficina) y servidor OK -> true', () => {
    expect(recoveryCloses('DOWN', null, 'OK')).toBe(true);
  });

  it('DOWN con servidor sin datos -> false', () => {
    expect(recoveryCloses('DOWN', 'OK', null)).toBe(false);
  });

  it('ROUTE con oficina OK -> true; con oficina FAILED -> false', () => {
    expect(recoveryCloses('ROUTE', 'OK', 'FAILED')).toBe(true);
    expect(recoveryCloses('ROUTE', 'FAILED', 'OK')).toBe(false);
  });

  it('DEGRADED nunca se cierra por RECOVERED: exige DEGRADATION_CLEARED', () => {
    expect(recoveryCloses('DEGRADED', 'OK', 'OK')).toBe(false);
  });
});

describe('formatDuration', () => {
  it('minutos y horas', () => {
    expect(formatDuration(30_000)).toBe('menos de 1 min');
    expect(formatDuration(7 * MIN)).toBe('7 min');
    expect(formatDuration(65 * MIN)).toBe('1 h 05 min');
  });
});
