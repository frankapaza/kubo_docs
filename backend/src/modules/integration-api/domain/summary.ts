import { BadRequestException } from '@nestjs/common';
import { PERU_UTC_OFFSET_MINUTES } from '../../../common/peru-month';
import { MonthlyReportBody } from '../../portal/domain/monthly-report';

export interface YearMonth {
  year: number;
  month: number;
}

export interface MesResumen {
  mes: string;
  tickets: {
    recibidos: number;
    resueltosEnMes: number;
    pendientes: number;
    cumplimientoRespuestaPct: number | null;
    cumplimientoResolucionPct: number | null;
    resolucionMediaHoras: number | null;
    resolucionMedianaHoras: number | null;
  };
  requerimientos: {
    solicitados: number;
    aceptados: number;
    entregados: number;
    rechazados: number;
    cumplimientoCompromisoPct: number | null;
  };
}

export interface ResumenApi {
  /** Foto de ahora: tickets visibles sin resolver ni cerrar. */
  abiertos: { porEstado: Record<string, number>; porPrioridad: Record<string, number> };
  meses: MesResumen[];
}

/** Rango máximo del resumen: dos años de meses. */
export const MAX_MONTHS = 24;
const YM = /^(\d{4})-(\d{2})$/;
const bad = (message: string) => new BadRequestException({ code: 'BAD_INPUT', message });
const round2 = (n: number) => Math.round(n * 100) / 100;

function parseYm(s: string, name: string): YearMonth {
  const m = YM.exec(s.trim());
  const year = m ? Number(m[1]) : NaN;
  const month = m ? Number(m[2]) : NaN;
  if (!m || month < 1 || month > 12 || year < 2000 || year > 2100) throw bad(`«${name}» debe ser un mes YYYY-MM`);
  return { year, month };
}

/** Mes civil de Perú en el que cae `now`. */
export function peruMonthOf(now: Date): YearMonth {
  const civil = new Date(now.getTime() + PERU_UTC_OFFSET_MINUTES * 60_000);
  return { year: civil.getUTCFullYear(), month: civil.getUTCMonth() + 1 };
}

const index = (ym: YearMonth) => ym.year * 12 + (ym.month - 1);
const fromIndex = (i: number): YearMonth => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });

/** Meses del resumen, de `desde` a `hasta` (YYYY-MM). Por defecto los 12 meses hasta el actual de Perú. */
export function parseMonthRange(desde: string | undefined, hasta: string | undefined, now: Date): YearMonth[] {
  const end = hasta ? parseYm(hasta, 'hasta') : peruMonthOf(now);
  const start = desde ? parseYm(desde, 'desde') : fromIndex(index(end) - 11);
  const n = index(end) - index(start) + 1;
  if (n < 1) throw bad('«desde» no puede ser posterior a «hasta»');
  if (n > MAX_MONTHS) throw bad(`El rango no puede pasar de ${MAX_MONTHS} meses`);
  return Array.from({ length: n }, (_, k) => fromIndex(index(start) + k));
}

/** Media y mediana, en horas, de captura a resolución de los tickets resueltos. */
export function resolutionStats(rows: Array<{ capturedAt: Date; resolvedAt: Date | null }>): { media: number | null; mediana: number | null } {
  const hours = rows
    .filter((r) => r.resolvedAt)
    .map((r) => (new Date(r.resolvedAt as Date).getTime() - new Date(r.capturedAt).getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  if (hours.length === 0) return { media: null, mediana: null };
  const mid = Math.floor(hours.length / 2);
  const mediana = hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
  return { media: round2(hours.reduce((a, b) => a + b, 0) / hours.length), mediana: round2(mediana) };
}

/** Un mes del resumen con las cifras del informe mensual (mismo cálculo de SLA). */
export function buildMonthEntry(
  ym: YearMonth,
  body: MonthlyReportBody,
  ticketRows: Array<{ capturedAt: Date; resolvedAt: Date | null }>,
): MesResumen {
  const t = body.tickets!.totals;
  const r = body.requirements!.totals;
  const res = resolutionStats(ticketRows);
  return {
    mes: `${ym.year}-${String(ym.month).padStart(2, '0')}`,
    tickets: {
      recibidos: t.received,
      resueltosEnMes: t.resolvedInPeriod,
      pendientes: t.pending,
      cumplimientoRespuestaPct: t.responseCompliancePercent,
      cumplimientoResolucionPct: t.resolutionCompliancePercent,
      resolucionMediaHoras: res.media,
      resolucionMedianaHoras: res.mediana,
    },
    requerimientos: {
      solicitados: r.requested,
      aceptados: r.accepted,
      entregados: r.delivered,
      rechazados: r.rejected,
      cumplimientoCompromisoPct: r.commitmentCompliancePercent,
    },
  };
}
