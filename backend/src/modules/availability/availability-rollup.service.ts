import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { And, Between, DataSource, EntityManager, In, IsNull, LessThan, MoreThan, MoreThanOrEqual } from 'typeorm';
import { addDays, expectedSlots, limaDateOf, limaDayBounds } from './domain/expected-slots';
import { incidentIntervals } from './domain/incident-intervals';
import { histogramOf, PERCENT_BUCKETS, percentileFromHistogram } from './domain/latency-histogram';
import { probeGaps, subtractIntervals } from './domain/probe-gaps';
import { MonitorAgentDailyRollup } from './entities/monitor-agent-daily-rollup.entity';
import { MonitorAgentSample } from './entities/monitor-agent-sample.entity';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorDailyRollup } from './entities/monitor-daily-rollup.entity';
import { MonitorIncidentEvent } from './entities/monitor-incident-event.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorOfficeOutage } from './entities/monitor-office-outage.entity';
import { MonitorProbeGap } from './entities/monitor-probe-gap.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorRollupDay } from './entities/monitor-rollup-day.entity';
import { MonitorService } from './entities/monitor-service.entity';

/** Días hacia atrás que se resumen (los checks se purgan a los 90). */
export const ROLLUP_LOOKBACK_DAYS = 89;
/**
 * Días completos más recientes que la pasada recalcula siempre, aunque ya estén
 * resumidos: la sonda de la oficina sube tarde lo que guardó durante un corte.
 */
export const ROLLUP_RECOMPUTE_DAYS = 2;
const INSERT_CHUNK = 500;
const MIN_MS = 60_000;

type RollupRow = Omit<MonitorDailyRollup, 'id'>;
type GapRow = Omit<MonitorProbeGap, 'id'>;
type AgentRollupRow = Omit<MonitorAgentDailyRollup, 'id'>;
type ServiceMinutes = { down: number; route: number };
type Interval = [Date, Date];

const round2 = (n: number) => Math.round(n * 100) / 100;
const overlapMin = (a: Date, b: Date, from: Date, to: Date) =>
  Math.max(0, Math.min(b.getTime(), to.getTime()) - Math.max(a.getTime(), from.getTime())) / MIN_MS;
const minDate = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

/**
 * Resúmenes diarios (hora de Lima) de disponibilidad por servicio y sonda, más
 * los huecos de cada sonda. El informe mensual se arma con estas filas, sin
 * releer `monitor_checks`. Corre solo en el backend (AvailabilityModule).
 */
@Injectable()
export class AvailabilityRollupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AvailabilityRollupService.name);
  private running = false;

  constructor(private readonly ds: DataSource) {}

  /** Al arrancar completa los días que falten, sin frenar el arranque. */
  onApplicationBootstrap(): void {
    void this.run();
  }

  @Cron('0 30 0 * * *', { timeZone: 'America/Lima' })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const today = limaDateOf(now);
      // Los días viejos solo si faltan; ayer y anteayer siempre (datos tardíos).
      await this.ensureRange(addDays(today, -ROLLUP_LOOKBACK_DAYS), addDays(today, -ROLLUP_RECOMPUTE_DAYS - 1), now);
      for (let back = ROLLUP_RECOMPUTE_DAYS; back >= 1; back--) {
        const d = addDays(today, -back);
        try {
          await this.rollupDay(d, now);
        } catch (e) {
          this.logger.error(`Resumen de disponibilidad del ${d} fallido: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Resumen diario de disponibilidad fallido: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Resume los días del rango que aún no están en `monitor_rollup_days` (nunca hoy ni más de 89 días atrás). */
  async ensureRange(fromDate: string, toDate: string, now: Date): Promise<void> {
    const today = limaDateOf(now);
    const lo = [fromDate, addDays(today, -ROLLUP_LOOKBACK_DAYS)].sort()[1];
    const hi = [toDate, addDays(today, -1)].sort()[0];
    if (lo > hi) return;
    const done = await this.ds.getRepository(MonitorRollupDay).find({ where: { date: Between(lo, hi) } });
    const doneSet = new Set(done.map((d) => String(d.date)));
    for (let d = lo; d <= hi; d = addDays(d, 1)) {
      if (doneSet.has(d)) continue;
      try {
        await this.rollupDay(d, now);
      } catch (e) {
        this.logger.error(`Resumen de disponibilidad del ${d} fallido: ${(e as Error).message}`);
      }
    }
  }

  /** Recalcula una fecha: borra e inserta sus resúmenes y huecos en una sola transacción. Idempotente. */
  async rollupDay(date: string, now: Date): Promise<void> {
    const { from, to } = limaDayBounds(date);
    const until = minDate(to, now);

    // Paso 1: disponibilidad por servicio y sonda, y huecos por sonda.
    const { rollups, gaps } = await this.computeProbeRollups(date, from, to, until);
    // Paso 2: recursos del agente por servidor.
    const agentRollups = await this.computeAgentRollups(date, from, to);

    await this.ds.transaction(async (m) => {
      await this.replaceRows(m, MonitorDailyRollup, date, rollups);
      await this.replaceRows(m, MonitorProbeGap, date, gaps);
      await this.replaceRows(m, MonitorAgentDailyRollup, date, agentRollups);
      await m.getRepository(MonitorRollupDay).save({ date, computedAt: now });
    });
  }

  private async replaceRows<T extends RollupRow | GapRow | AgentRollupRow>(
    m: EntityManager,
    entity: typeof MonitorDailyRollup | typeof MonitorProbeGap | typeof MonitorAgentDailyRollup,
    date: string,
    rows: T[],
  ): Promise<void> {
    const repo = m.getRepository(entity);
    await repo.delete({ date });
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) await repo.insert(rows.slice(i, i + INSERT_CHUNK) as any);
  }

  private async computeProbeRollups(
    date: string,
    from: Date,
    to: Date,
    until: Date,
  ): Promise<{ rollups: RollupRow[]; gaps: GapRow[] }> {
    const services = await this.ds.getRepository(MonitorService).find({
      where: { status: In(['ACTIVE', 'PAUSED']), createdAt: LessThan(to) },
      order: { id: 'ASC' },
    });
    const probes = await this.ds.getRepository(MonitorProbe).find({ order: { id: 'ASC' } });
    const minutes = await this.serviceMinutes(services.map((s) => Number(s.id)), from, until);
    const outages = await this.ds.getRepository(MonitorOfficeOutage).find({
      where: [
        { startedAt: LessThan(until), endedAt: IsNull() },
        { startedAt: LessThan(until), endedAt: MoreThan(from) },
      ],
    });
    const expected = new Map(services.map((s) => [Number(s.id), expectedSlots(Number(s.id), date)]));

    const rollups: RollupRow[] = [];
    const gaps: GapRow[] = [];
    const checksRepo = this.ds.getRepository(MonitorCheck);
    for (const probe of probes) {
      const probeId = Number(probe.id);
      // Una sonda que aún no reportaba ese día (o nunca) no tiene resumen ni huecos.
      const first = await checksRepo.findOne({
        where: { probeId },
        order: { startedAt: 'ASC' },
        select: { probeId: true, id: true, startedAt: true },
      });
      if (!first) continue;
      const firstAt = new Date(first.startedAt);
      if (firstAt.getTime() >= to.getTime()) continue;

      // Checks del día de esta sonda (índice probe_id, started_at), en orden.
      const checks = await checksRepo.find({
        where: { probeId, startedAt: And(MoreThanOrEqual(from), LessThan(to)) },
        order: { startedAt: 'ASC' },
        select: { probeId: true, id: true, serviceId: true, kind: true, ok: true, durationMs: true, startedAt: true },
      });

      const byService = new Map<number, MonitorCheck[]>();
      for (const c of checks) {
        if (c.kind !== 'REGULAR') continue;
        const sid = Number(c.serviceId);
        (byService.get(sid) ?? byService.set(sid, []).get(sid)!).push(c);
      }
      for (const s of services) {
        const sid = Number(s.id);
        const regular = byService.get(sid) ?? [];
        const okDurations = regular.filter((c) => c.ok).map((c) => Number(c.durationMs));
        const hist = histogramOf(okDurations);
        const exp = expected.get(sid) ?? 0;
        const min = minutes.get(sid) ?? { down: 0, route: 0 };
        rollups.push({
          serviceId: sid,
          probeId,
          date,
          expected: exp,
          executed: regular.length,
          succeeded: okDurations.length,
          p50Ms: percentileFromHistogram(hist, 0.5),
          p95Ms: percentileFromHistogram(hist, 0.95),
          latencyHist: hist,
          downMinutes: round2(min.down),
          routeMinutes: round2(min.route),
          noDataMinutes: exp > 0 ? round2(Math.max(0, exp - regular.length) * (1440 / exp)) : 0,
        });
      }

      gaps.push(...this.probeDayGaps(probeId, date, maxDate(from, firstAt), until, checks, outages));
    }
    return { rollups, gaps };
  }

  /**
   * Resumen del agente por servidor con muestras ese día: cantidad, histogramas
   * de CPU y RAM (`PERCENT_BUCKETS`) y los discos de la última muestra del día.
   */
  private async computeAgentRollups(date: string, from: Date, to: Date): Promise<AgentRollupRow[]> {
    const samples = await this.ds.getRepository(MonitorAgentSample).find({
      where: { at: And(MoreThanOrEqual(from), LessThan(to)) },
      order: { serverId: 'ASC', at: 'ASC' },
      select: { id: true, serverId: true, at: true, cpuPct: true, ramPct: true, disks: true },
    });
    const byServer = new Map<number, MonitorAgentSample[]>();
    for (const s of samples) {
      const sid = Number(s.serverId);
      (byServer.get(sid) ?? byServer.set(sid, []).get(sid)!).push(s);
    }
    const out: AgentRollupRow[] = [];
    for (const [serverId, rows] of [...byServer].sort((a, b) => a[0] - b[0])) {
      const last = rows.reduce((a, s) => (new Date(s.at).getTime() >= new Date(a.at).getTime() ? s : a));
      out.push({
        serverId,
        date,
        samples: rows.length,
        cpuHist: histogramOf(rows.map((s) => Number(s.cpuPct)), PERCENT_BUCKETS),
        ramHist: histogramOf(rows.map((s) => Number(s.ramPct)), PERCENT_BUCKETS),
        disksClose: last.disks ?? [],
      });
    }
    return out;
  }

  /** Huecos de la sonda: caídas de oficina recortadas al día y silencios fuera de ellas. */
  private probeDayGaps(
    probeId: number,
    date: string,
    from: Date,
    until: Date,
    checks: MonitorCheck[],
    outages: MonitorOfficeOutage[],
  ): GapRow[] {
    const cuts: Interval[] = outages
      .filter((o) => Number(o.probeId) === probeId)
      .map((o): Interval => [maxDate(new Date(o.startedAt), from), minDate(o.endedAt ? new Date(o.endedAt) : until, until)])
      .filter(([a, b]) => b.getTime() > a.getTime());
    const out: GapRow[] = cuts.map(([a, b]) => ({ probeId, startedAt: a, endedAt: b, cause: 'OFFICE_OUTAGE', date }));
    const silent = probeGaps(checks.map((c) => new Date(c.startedAt)), from, until);
    for (const g of silent) {
      for (const [a, b] of subtractIntervals(g, cuts)) {
        out.push({ probeId, startedAt: a, endedAt: b, cause: 'PROBE_SILENT', date });
      }
    }
    return out.sort((x, y) => x.startedAt.getTime() - y.startedAt.getTime());
  }

  /** Minutos DOWN y ROUTE de cada servicio dentro de [from, until), solo incidentes de servicio. */
  private async serviceMinutes(serviceIds: number[], from: Date, until: Date): Promise<Map<number, ServiceMinutes>> {
    const out = new Map<number, ServiceMinutes>();
    if (serviceIds.length === 0) return out;
    const base = { serviceId: In(serviceIds), kind: In(['DOWN', 'ROUTE']), firstFailureAt: LessThan(until) };
    // Solo incidentes de servicio (los padres de servidor tienen service_id nulo).
    const incidents = await this.ds.getRepository(MonitorIncident).find({
      where: [
        { ...base, recoveredAt: IsNull() },
        { ...base, recoveredAt: MoreThan(from) },
      ],
    });
    if (incidents.length === 0) return out;

    const upgrades = await this.ds.getRepository(MonitorIncidentEvent).find({
      where: { incidentId: In(incidents.map((i) => Number(i.id))), type: 'UPGRADED_TO_DOWN' },
      order: { at: 'ASC' },
    });
    const upgradedAt = new Map<number, Date>();
    for (const e of upgrades) if (!upgradedAt.has(Number(e.incidentId))) upgradedAt.set(Number(e.incidentId), new Date(e.at));

    for (const inc of incidents) {
      const sid = Number(inc.serviceId);
      const acc = out.get(sid) ?? { down: 0, route: 0 };
      const intervals = incidentIntervals(
        {
          kind: inc.kind,
          firstFailureAt: new Date(inc.firstFailureAt),
          recoveredAt: inc.recoveredAt ? new Date(inc.recoveredAt) : null,
        },
        upgradedAt.get(Number(inc.id)) ?? null,
        until,
      );
      for (const iv of intervals) {
        const mins = overlapMin(iv.from, iv.to, from, until);
        if (iv.kind === 'DOWN') acc.down += mins;
        else acc.route += mins;
      }
      out.set(sid, acc);
    }
    return out;
  }
}
