import { DISK_TREND_MIN_SPAN_DAYS, estimateDaysToFull, trendSpanDays } from './disk-trend';

const GB = 1024 ** 3;
const NOW = new Date('2026-11-24T15:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('estimateDaysToFull', () => {
  it('100 GB libres que bajan 1 GB por día -> ≈ 100 días', () => {
    const points = [6, 5, 4, 3, 2, 1, 0].map((d) => ({ at: daysAgo(d), freeBytes: (100 + d) * GB }));
    expect(estimateDaysToFull(points)).toBeCloseTo(100, 5);
  });

  it('espacio estable -> null', () => {
    const points = [3, 2, 1, 0].map((d) => ({ at: daysAgo(d), freeBytes: 50 * GB }));
    expect(estimateDaysToFull(points)).toBeNull();
  });

  it('espacio que crece -> null', () => {
    expect(estimateDaysToFull([{ at: daysAgo(3), freeBytes: 10 * GB }, { at: daysAgo(0), freeBytes: 20 * GB }])).toBeNull();
  });

  it(`menos de ${DISK_TREND_MIN_SPAN_DAYS} días de historia -> null aunque baje`, () => {
    // Unas horas de datos: 1 GB menos en 2 h daría ~2 días para llenarse; no se estima.
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    expect(estimateDaysToFull([{ at: hoursAgo(2), freeBytes: 25 * GB }, { at: NOW, freeBytes: 24 * GB }])).toBeNull();
    // Justo 3 días: ya estima.
    expect(estimateDaysToFull([{ at: daysAgo(3), freeBytes: 103 * GB }, { at: NOW, freeBytes: 100 * GB }])).toBeCloseTo(100, 5);
  });

  it('trendSpanDays: días entre el punto más antiguo y el más reciente', () => {
    expect(trendSpanDays([])).toBe(0);
    expect(trendSpanDays([{ at: daysAgo(2.5) }, { at: NOW }, { at: daysAgo(1) }])).toBeCloseTo(2.5, 5);
  });

  it('menos de 2 puntos -> null', () => {
    expect(estimateDaysToFull([])).toBeNull();
    expect(estimateDaysToFull([{ at: NOW, freeBytes: GB }])).toBeNull();
  });

  it('más de 3650 días -> null', () => {
    // Baja 1 MB por día con 100 GB libres: ~100 000 días.
    const points = [1, 0].map((d) => ({ at: daysAgo(d), freeBytes: 100 * GB + d * 1024 ** 2 }));
    expect(estimateDaysToFull(points)).toBeNull();
  });

  it('solo usa los últimos 7 días respecto del punto más reciente', () => {
    // Un punto viejo (20 días) con mucho menos espacio haría crecer la pendiente; se descarta.
    const points = [
      { at: daysAgo(20), freeBytes: 1 * GB },
      ...[3, 2, 1, 0].map((d) => ({ at: daysAgo(d), freeBytes: (100 + d) * GB })),
    ];
    expect(estimateDaysToFull(points)).toBeCloseTo(100, 5);
  });

  it('todos en el mismo instante -> null', () => {
    expect(estimateDaysToFull([{ at: NOW, freeBytes: 2 * GB }, { at: NOW, freeBytes: GB }])).toBeNull();
  });
});
