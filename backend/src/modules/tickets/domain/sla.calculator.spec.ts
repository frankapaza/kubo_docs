import {
  computeDueDates,
  shiftForPause,
  consumedRatio,
  isAtRisk,
  DEFAULT_SLA_MATRIX,
  AT_RISK_THRESHOLD,
} from './sla.calculator';

const T0 = new Date('2026-07-31T08:00:00.000Z');
const min = (n: number) => n * 60 * 1000;

describe('computeDueDates', () => {
  it('aplica los minutos de la matriz por defecto para P1', () => {
    const r = computeDueDates(T0, 'P1', DEFAULT_SLA_MATRIX);
    expect(r.responseDueAt.getTime()).toBe(T0.getTime() + min(15));
    expect(r.resolutionDueAt.getTime()).toBe(T0.getTime() + min(240));
  });

  it('aplica los minutos de la matriz por defecto para P4', () => {
    const r = computeDueDates(T0, 'P4', DEFAULT_SLA_MATRIX);
    expect(r.responseDueAt.getTime()).toBe(T0.getTime() + min(240));
    expect(r.resolutionDueAt.getTime()).toBe(T0.getTime() + min(1440));
  });

  it('cuenta horas corridas: cruza la noche y el fin de semana sin pausar', () => {
    const viernes17 = new Date('2026-07-31T17:00:00.000Z');
    const r = computeDueDates(viernes17, 'P3', DEFAULT_SLA_MATRIX);
    // P3 resolucion 12h -> vence a las 05:00 del dia siguiente
    expect(r.resolutionDueAt.toISOString()).toBe('2026-08-01T05:00:00.000Z');
  });
});

describe('shiftForPause', () => {
  it('desplaza ambos vencimientos por la duracion de la pausa', () => {
    const due = computeDueDates(T0, 'P2', DEFAULT_SLA_MATRIX);
    const pausedAt = new Date(T0.getTime() + min(10));
    const resumedAt = new Date(T0.getTime() + min(40)); // 30 min de pausa

    const r = shiftForPause({
      pausedAt,
      resumedAt,
      responseDueAt: due.responseDueAt,
      resolutionDueAt: due.resolutionDueAt,
    });

    expect(r.pausedSeconds).toBe(30 * 60);
    expect(r.responseDueAt!.getTime()).toBe(due.responseDueAt.getTime() + min(30));
    expect(r.resolutionDueAt!.getTime()).toBe(due.resolutionDueAt.getTime() + min(30));
  });

  it('acumula pausas sucesivas', () => {
    const due = computeDueDates(T0, 'P2', DEFAULT_SLA_MATRIX);

    const p1 = shiftForPause({
      pausedAt: new Date(T0.getTime() + min(10)),
      resumedAt: new Date(T0.getTime() + min(40)),
      responseDueAt: due.responseDueAt,
      resolutionDueAt: due.resolutionDueAt,
    });
    const p2 = shiftForPause({
      pausedAt: new Date(T0.getTime() + min(60)),
      resumedAt: new Date(T0.getTime() + min(75)),
      responseDueAt: p1.responseDueAt,
      resolutionDueAt: p1.resolutionDueAt,
    });

    expect(p2.resolutionDueAt!.getTime()).toBe(due.resolutionDueAt.getTime() + min(45));
  });

  it('no acepta una reanudacion anterior a la pausa', () => {
    const due = computeDueDates(T0, 'P2', DEFAULT_SLA_MATRIX);
    expect(() =>
      shiftForPause({
        pausedAt: new Date(T0.getTime() + min(40)),
        resumedAt: new Date(T0.getTime() + min(10)),
        responseDueAt: due.responseDueAt,
        resolutionDueAt: due.resolutionDueAt,
      }),
    ).toThrow();
  });
});

describe('consumedRatio', () => {
  const due = computeDueDates(T0, 'P1', DEFAULT_SLA_MATRIX); // 240 min

  it('es 0 al crear y 1 al vencer', () => {
    expect(
      consumedRatio({ now: T0, createdAt: T0, resolutionDueAt: due.resolutionDueAt, pausedTotalSeconds: 0, pausedAt: null }),
    ).toBeCloseTo(0);
    expect(
      consumedRatio({ now: due.resolutionDueAt, createdAt: T0, resolutionDueAt: due.resolutionDueAt, pausedTotalSeconds: 0, pausedAt: null }),
    ).toBeCloseTo(1);
  });

  it('descuenta el tiempo ya pausado', () => {
    // 120 min transcurridos, de los cuales 60 fueron pausa -> 60/240 activos
    const shifted = new Date(due.resolutionDueAt.getTime() + min(60));
    const ratio = consumedRatio({
      now: new Date(T0.getTime() + min(120)),
      createdAt: T0,
      resolutionDueAt: shifted,
      pausedTotalSeconds: 60 * 60,
      pausedAt: null,
    });
    expect(ratio).toBeCloseTo(0.25);
  });

  it('descuenta tambien la pausa en curso', () => {
    // 120 min transcurridos, en pausa desde el minuto 60 -> 60 activos de 240
    const ratio = consumedRatio({
      now: new Date(T0.getTime() + min(120)),
      createdAt: T0,
      resolutionDueAt: due.resolutionDueAt,
      pausedTotalSeconds: 0,
      pausedAt: new Date(T0.getTime() + min(60)),
    });
    expect(ratio).toBeCloseTo(0.25);
  });
});

describe('isAtRisk', () => {
  const due = computeDueDates(T0, 'P1', DEFAULT_SLA_MATRIX); // 240 min

  it('el umbral es 70%', () => {
    expect(AT_RISK_THRESHOLD).toBe(0.7);
  });

  it('no marca en riesgo por debajo del umbral', () => {
    const now = new Date(T0.getTime() + min(167)); // 69.6%
    expect(isAtRisk({ now, createdAt: T0, resolutionDueAt: due.resolutionDueAt, pausedTotalSeconds: 0, pausedAt: null })).toBe(false);
  });

  it('marca en riesgo al alcanzar el umbral', () => {
    const now = new Date(T0.getTime() + min(168)); // 70%
    expect(isAtRisk({ now, createdAt: T0, resolutionDueAt: due.resolutionDueAt, pausedTotalSeconds: 0, pausedAt: null })).toBe(true);
  });
});
