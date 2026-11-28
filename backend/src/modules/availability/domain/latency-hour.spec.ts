import { MIN_PINGS, SLOW_SHARE, episodeStep, isOfficeWide, isSlowHour, summarizeHour } from './latency-hour';

const pings = (ms: number[], fail = 0) => [
  ...ms.map((durationMs) => ({ durationMs, ok: true })),
  ...Array.from({ length: fail }, () => ({ durationMs: 5000, ok: false })),
];

describe('summarizeHour', () => {
  it('cuenta lentos (sobre el umbral) y fallidos; promedio, p95 y máximo de los correctos', () => {
    const s = summarizeHour(pings([100, 110, 120, 300, 400], 1), 250);
    expect(s).toEqual({ total: 6, slow: 3, avgMs: 206, p95Ms: 400, maxMs: 400 });
  });

  it('justo en el umbral no es lento', () => {
    expect(summarizeHour(pings([250, 251]), 250).slow).toBe(1);
  });

  it('sin pings correctos: sin promedio ni p95', () => {
    expect(summarizeHour(pings([], 3), 250)).toEqual({ total: 3, slow: 3, avgMs: null, p95Ms: null, maxMs: null });
  });

  it('p95 por rango más cercano', () => {
    const ms = Array.from({ length: 60 }, (_, i) => 100 + i); // 100..159
    expect(summarizeHour(pings(ms), 1000).p95Ms).toBe(156);
  });
});

describe('isSlowHour', () => {
  it(`lenta con ≥ ${SLOW_SHARE * 100} % de pings lentos y al menos ${MIN_PINGS} pings`, () => {
    expect(isSlowHour({ total: 60, slow: 12 })).toBe(true);
    expect(isSlowHour({ total: 60, slow: 11 })).toBe(false);
    expect(isSlowHour({ total: 12, slow: 3 })).toBe(true); // motor antiguo: 12 por hora
    expect(isSlowHour({ total: 9, slow: 9 })).toBe(false); // muy pocos datos
  });
});

describe('isOfficeWide', () => {
  it('todos los pings con datos lentos a la vez (al menos 2) → oficina', () => {
    expect(isOfficeWide([true, true, true])).toBe(true);
    expect(isOfficeWide([true, false, true])).toBe(false);
    expect(isOfficeWide([true])).toBe(false);
    expect(isOfficeWide([])).toBe(false);
  });
});

describe('episodeStep', () => {
  const slow = { total: 60, slow: 30 };
  const normal = { total: 60, slow: 2 };
  const sinDatos = { total: 3, slow: 0 };

  it('hora lenta sin episodio → abrir', () => expect(episodeStep(false, slow)).toBe('OPEN'));
  it('hora lenta con episodio → seguir', () => expect(episodeStep(true, slow)).toBe('NONE'));
  it('hora normal con episodio → cerrar', () => expect(episodeStep(true, normal)).toBe('CLOSE'));
  it('hora normal sin episodio → nada', () => expect(episodeStep(false, normal)).toBe('NONE'));
  it('hora sin datos suficientes (motor apagado) no abre ni cierra', () => {
    expect(episodeStep(true, sinDatos)).toBe('NONE');
    expect(episodeStep(false, sinDatos)).toBe('NONE');
  });
});
