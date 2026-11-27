import { buildMonthEntry, parseMonthRange, resolutionStats } from './summary';

const bad = { response: expect.objectContaining({ code: 'BAD_INPUT' }) };
const NOW = new Date('2026-11-27T18:00:00Z');

describe('parseMonthRange', () => {
  it('por defecto: los 12 meses hasta el actual (Perú)', () => {
    const r = parseMonthRange(undefined, undefined, NOW);
    expect(r).toHaveLength(12);
    expect(r[0]).toEqual({ year: 2025, month: 12 });
    expect(r[11]).toEqual({ year: 2026, month: 11 });
  });
  it('el 1 de diciembre a las 02:00 UTC todavía es noviembre en Perú', () => {
    const r = parseMonthRange(undefined, undefined, new Date('2026-12-01T02:00:00Z'));
    expect(r[11]).toEqual({ year: 2026, month: 11 });
  });
  it('rango explícito; formato inválido, desde > hasta o más de 24 meses -> 400', () => {
    expect(parseMonthRange('2026-01', '2026-03', NOW)).toEqual([{ year: 2026, month: 1 }, { year: 2026, month: 2 }, { year: 2026, month: 3 }]);
    expect(() => parseMonthRange('2026-13', undefined, NOW)).toThrow(expect.objectContaining(bad));
    expect(() => parseMonthRange('2026-05', '2026-03', NOW)).toThrow(expect.objectContaining(bad));
    expect(() => parseMonthRange('2024-01', '2026-01', NOW)).toThrow(expect.objectContaining(bad));
  });
  it('solo desde: hasta el mes actual', () => {
    expect(parseMonthRange('2026-10', undefined, NOW)).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 11 }]);
  });
});

describe('resolutionStats', () => {
  const t = (h: number | null) => ({ capturedAt: new Date('2026-11-01T00:00:00Z'), resolvedAt: h === null ? null : new Date(Date.UTC(2026, 10, 1, h)) });
  it('media y mediana en horas de los resueltos; sin resueltos -> null', () => {
    expect(resolutionStats([t(1), t(3), t(10), t(null)])).toEqual({ media: 4.67, mediana: 3 });
    expect(resolutionStats([t(2), t(4)])).toEqual({ media: 3, mediana: 3 });
    expect(resolutionStats([t(null)])).toEqual({ media: null, mediana: null });
  });
});

describe('buildMonthEntry', () => {
  it('toma las cifras del informe mensual tal cual', () => {
    const body: any = {
      tickets: { totals: { received: 5, resolvedInPeriod: 3, pending: 2, responseCompliancePercent: 80, resolutionCompliancePercent: 66.67 } },
      requirements: { totals: { requested: 2, accepted: 1, delivered: 1, rejected: 1, commitmentCompliancePercent: null } },
    };
    expect(buildMonthEntry({ year: 2026, month: 3 }, body, [])).toEqual({
      mes: '2026-03',
      tickets: { recibidos: 5, resueltosEnMes: 3, pendientes: 2, cumplimientoRespuestaPct: 80, cumplimientoResolucionPct: 66.67, resolucionMediaHoras: null, resolucionMedianaHoras: null },
      requerimientos: { solicitados: 2, aceptados: 1, entregados: 1, rechazados: 1, cumplimientoCompromisoPct: null },
    });
  });
});
