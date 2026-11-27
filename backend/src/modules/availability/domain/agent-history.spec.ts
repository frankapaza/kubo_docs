import { dayHistory, mergeSummaries, monthHistory, summarizeSamples, yearHistory, yearStartDate } from './agent-history';

const s = (iso: string, cpu: number, ram: number, errors = 0) => ({ at: new Date(iso), cpuPct: cpu, ramPct: ram, eventErrors: errors });

describe('agent-history', () => {
  it('summarizeSamples: media, máximo y suma de errores', () => {
    expect(summarizeSamples([s('2026-11-27T10:00:00Z', 10, 40, 1), s('2026-11-27T10:01:00Z', 30, 60, 2)])).toEqual({
      samples: 2, cpuAvg: 20, cpuMax: 30, ramAvg: 50, ramMax: 60, eventErrors: 3,
    });
    expect(summarizeSamples([])).toEqual({ samples: 0, cpuAvg: null, cpuMax: null, ramAvg: null, ramMax: null, eventErrors: 0 });
  });

  it('dayHistory: 96 tramos de 15 min, el último contiene now, claves en hora de Lima', () => {
    const now = new Date('2026-11-27T18:07:00Z');
    const pts = dayHistory([s('2026-11-27T18:01:00Z', 50, 50, 4), s('2026-11-26T17:00:00Z', 99, 99)], now);
    expect(pts).toHaveLength(96);
    const last = pts[95];
    expect(last.from).toBe('2026-11-27T18:00:00.000Z');
    expect(last.key).toBe('2026-11-27T13:00');
    expect(last).toMatchObject({ samples: 1, cpuAvg: 50, errors: 4 });
    expect(pts[0].from).toBe('2026-11-26T18:15:00.000Z');
    expect(pts.reduce((a, p) => a + p.samples, 0)).toBe(1); // la muestra de hace más de 24 h queda fuera
  });

  it('monthHistory: 30 días de Lima con hoy al final; una muestra a las 02:00 UTC cuenta en el día anterior de Lima', () => {
    const now = new Date('2026-11-27T18:00:00Z');
    const pts = monthHistory([s('2026-11-27T02:00:00Z', 10, 20), s('2026-11-27T15:00:00Z', 30, 40)], now);
    expect(pts).toHaveLength(30);
    expect(pts[29].key).toBe('2026-11-27');
    expect(pts[28].key).toBe('2026-11-26');
    expect(pts[28]).toMatchObject({ samples: 1, cpuAvg: 10 });
    expect(pts[29]).toMatchObject({ samples: 1, cpuAvg: 30 });
    expect(pts[0].key).toBe('2026-10-29');
  });

  it('mergeSummaries pondera por muestras', () => {
    const m = mergeSummaries([
      { samples: 1, cpuAvg: 10, cpuMax: 10, ramAvg: 10, ramMax: 10, eventErrors: 1 },
      { samples: 3, cpuAvg: 30, cpuMax: 50, ramAvg: 30, ramMax: 40, eventErrors: 2 },
      { samples: 0, cpuAvg: null, cpuMax: null, ramAvg: null, ramMax: null, eventErrors: 0 },
    ]);
    expect(m).toEqual({ samples: 4, cpuAvg: 25, cpuMax: 50, ramAvg: 25, ramMax: 40, eventErrors: 3 });
  });

  it('yearHistory: 12 meses, resúmenes de días pasados + muestras de hoy, y respaldo por histograma', () => {
    const now = new Date('2026-11-27T18:00:00Z');
    const hist = (bucket: number) => { const h = new Array(21).fill(0); h[bucket] = 10; return h; };
    const pts = yearHistory(
      [
        { date: '2026-11-26', samples: 10, cpuHist: hist(0), ramHist: hist(0), cpuAvg: 20, cpuMax: 40, ramAvg: 50, ramMax: 60, eventErrors: 5 },
        // Día anterior a la 038: sin medias, se usan los histogramas (tramo 4 = 20-25 %).
        { date: '2026-03-10', samples: 10, cpuHist: hist(4), ramHist: hist(4), cpuAvg: null, cpuMax: null, ramAvg: null, ramMax: null, eventErrors: 0 },
        // Hoy no se toma del resumen (se recalcula de las muestras).
        { date: '2026-11-27', samples: 99, cpuHist: hist(0), ramHist: hist(0), cpuAvg: 99, cpuMax: 99, ramAvg: 99, ramMax: 99, eventErrors: 99 },
      ],
      [s('2026-11-27T15:00:00Z', 40, 50, 1)],
      now,
    );
    expect(pts).toHaveLength(12);
    expect(pts[11].key).toBe('2026-11');
    expect(pts[0].key).toBe('2025-12');
    expect(pts[11]).toMatchObject({ samples: 11, cpuMax: 40, errors: 6 });
    expect(pts[11].cpuAvg).toBeCloseTo((20 * 10 + 40) / 11, 2);
    const march = pts.find((p) => p.key === '2026-03')!;
    expect(march).toMatchObject({ samples: 10, cpuAvg: 25, cpuMax: 25 });
    expect(pts.find((p) => p.key === '2026-01')!.samples).toBe(0);
  });

  it('yearStartDate: día 1 de hace 11 meses', () => {
    expect(yearStartDate(new Date('2026-11-27T18:00:00Z'))).toBe('2025-12-01');
    expect(yearStartDate(new Date('2026-01-15T18:00:00Z'))).toBe('2025-02-01');
  });
});
