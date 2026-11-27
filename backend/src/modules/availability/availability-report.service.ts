import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { peruMonthBounds } from '../../common/peru-month';
import { ClientsService } from '../clients/clients.service';
import { ClientSystemsRepository } from '../tickets/client-systems.repository';
import { TicketsRepository } from '../tickets/tickets.repository';
import { AvailabilityEvidenceService } from './availability-evidence.service';
import { AvailabilityRollupService } from './availability-rollup.service';
import { AvailabilityReportData, computeAvailabilityReport, ReportTopIncident } from './domain/availability-report';
import { limaDateOf } from './domain/expected-slots';
import { toMaintenanceWindow } from './domain/maintenance-repo';
import { MonitorAgentDailyRollup } from './entities/monitor-agent-daily-rollup.entity';
import { MonitorDailyRollup } from './entities/monitor-daily-rollup.entity';
import { MonitorIncidentEvent } from './entities/monitor-incident-event.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorMaintenance } from './entities/monitor-maintenance.entity';
import { MonitorMonthlyReport } from './entities/monitor-monthly-report.entity';
import { MonitorProbeGap } from './entities/monitor-probe-gap.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';
import { ticketCodesForIncidents } from './incident-ticket-codes';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIN_MS = 60_000;
/** Hora de Lima del día 1 a la que se genera el informe del mes anterior. */
export const REPORT_HOUR_LIMA = 8;
const LIMA_SHIFT_MS = -300 * MIN_MS;

const badInput = (message: string) => new BadRequestException({ code: 'BAD_INPUT', message });
const n = (v: unknown): number => Number(v);
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface ReportListItem {
  month: string;
  partial: boolean;
  generatedAt: Date;
}

/** 'YYYY-MM' → año y mes, o 400 BAD_INPUT. */
export function parseMonth(month: string): { year: number; month: number } {
  const m = MONTH_RE.exec(typeof month === 'string' ? month : '');
  if (!m) throw badInput('El mes debe tener la forma AAAA-MM');
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** Mes de Lima ('YYYY-MM') en el instante dado, desplazado `delta` meses. */
export function limaMonthOf(instant: Date, delta = 0): string {
  const d = new Date(instant.getTime() + LIMA_SHIFT_MS);
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
  return x.toISOString().slice(0, 7);
}

/** Día 1 del mes en curso a las 08:00 de Lima. */
function reportTimeOf(now: Date): Date {
  const { year, month } = parseMonth(limaMonthOf(now));
  return new Date(peruMonthBounds(year, month).from.getTime() + REPORT_HOUR_LIMA * 60 * MIN_MS);
}

/**
 * Informe mensual de disponibilidad por cliente (spec «Disponibilidad mensual»).
 * Se arma con incidentes, mantenimientos y resúmenes diarios, y se congela en
 * `monitor_monthly_reports` por `(client_id, month)`. Solo corre en el backend.
 */
@Injectable()
export class AvailabilityReportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AvailabilityReportService.name);
  private running = false;

  constructor(
    @InjectRepository(MonitorMonthlyReport) private readonly reports: Repository<MonitorMonthlyReport>,
    @InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>,
    @InjectRepository(MonitorService) private readonly services: Repository<MonitorService>,
    @InjectRepository(MonitorProbe) private readonly probes: Repository<MonitorProbe>,
    @InjectRepository(MonitorIncident) private readonly incidents: Repository<MonitorIncident>,
    @InjectRepository(MonitorIncidentEvent) private readonly events: Repository<MonitorIncidentEvent>,
    @InjectRepository(MonitorMaintenance) private readonly maintenance: Repository<MonitorMaintenance>,
    @InjectRepository(MonitorDailyRollup) private readonly rollupRows: Repository<MonitorDailyRollup>,
    @InjectRepository(MonitorProbeGap) private readonly gaps: Repository<MonitorProbeGap>,
    @InjectRepository(MonitorAgentDailyRollup) private readonly agentRollups: Repository<MonitorAgentDailyRollup>,
    private readonly rollups: AvailabilityRollupService,
    private readonly evidence: AvailabilityEvidenceService,
    private readonly clients: ClientsService,
    private readonly clientSystems: ClientSystemsRepository,
    private readonly tickets: TicketsRepository,
  ) {}

  /** Al arrancar genera lo que falte del mes anterior, sin frenar el arranque. */
  onApplicationBootstrap(): void {
    void this.catchUp(new Date());
  }

  /** Día 1 a las 08:00 de Lima: el mes anterior de cada cliente (regenera si ya existía). */
  @Cron('0 0 8 1 * *', { timeZone: 'America/Lima' })
  async monthly(): Promise<void> {
    await this.runPass(new Date(), false);
  }

  /** Si ya pasó el día 1 a las 08:00 de Lima, genera los informes del mes anterior que no tengan fila cerrada (partial = false). */
  async catchUp(now: Date): Promise<void> {
    if (now.getTime() < reportTimeOf(now).getTime()) return;
    await this.runPass(now, true);
  }

  private async runPass(now: Date, onlyMissing: boolean): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const month = limaMonthOf(now, -1);
      const { year, month: mm } = parseMonth(month);
      const { from, to } = peruMonthBounds(year, mm);
      let clientIds = await this.clientsWithActivity(from, to);
      if (onlyMissing && clientIds.length) {
        // Solo cuenta como hecho un informe cerrado: uno parcial (generado a mano durante el mes) se rehace.
        const existing = await this.reports.find({
          where: { month, clientId: In(clientIds), partial: false },
          select: { id: true, clientId: true },
        });
        const done = new Set(existing.map((r) => n(r.clientId)));
        clientIds = clientIds.filter((id) => !done.has(id));
      }
      for (const clientId of clientIds) {
        try {
          await this.generate(clientId, month, now, null);
        } catch (e) {
          this.logger.error(`Informe de disponibilidad ${month} del cliente ${clientId} fallido: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Pasada del informe mensual fallida: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Clientes con al menos un servicio no archivado o con incidentes en `[from, to)`. */
  private async clientsWithActivity(from: Date, to: Date): Promise<number[]> {
    const servers = await this.servers.find({ select: { id: true, clientId: true } });
    const clientOf = new Map(servers.map((s) => [n(s.id), n(s.clientId)]));
    const out = new Set<number>();
    const active = await this.services.find({ where: { status: Not('ARCHIVED') }, select: { id: true, serverId: true } });
    for (const s of active) if (clientOf.has(n(s.serverId))) out.add(clientOf.get(n(s.serverId))!);
    const incs = await this.incidents.find({ where: this.overlapping(from, to), select: { id: true, serverId: true } });
    for (const i of incs) if (clientOf.has(n(i.serverId))) out.add(clientOf.get(n(i.serverId))!);
    return [...out].sort((a, b) => a - b);
  }

  /** Incidentes DOWN/ROUTE que se superponen con `[from, to)`. */
  private overlapping(from: Date, to: Date, extra: Record<string, unknown> = {}) {
    const base = { ...extra, kind: In(['DOWN', 'ROUTE']), firstFailureAt: LessThan(to) };
    return [
      { ...base, recoveredAt: IsNull() },
      { ...base, recoveredAt: MoreThan(from) },
    ];
  }

  async list(clientId: number): Promise<ReportListItem[]> {
    const rows = await this.reports.find({
      where: { clientId },
      order: { month: 'DESC' },
      select: { id: true, month: true, partial: true, generatedAt: true },
    });
    return rows.map((r) => ({ month: r.month, partial: !!r.partial, generatedAt: r.generatedAt }));
  }

  async get(clientId: number, month: string): Promise<AvailabilityReportData> {
    parseMonth(month);
    const row = await this.reports.findOne({ where: { clientId, month } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Informe no encontrado' });
    return row.data as AvailabilityReportData;
  }

  /** Genera (o regenera) el informe de `(clientId, month)`. El mes en curso sale `partial`. */
  async generate(clientId: number, month: string, now: Date, by: number | null): Promise<AvailabilityReportData> {
    const { year, month: mm } = parseMonth(month);
    const bounds = peruMonthBounds(year, mm);
    if (bounds.from.getTime() > now.getTime()) {
      throw new BadRequestException({ code: 'MES_FUTURO', message: 'No se puede generar el informe de un mes futuro' });
    }
    const client = await this.clients.findByIdOrFail(clientId);
    const from = bounds.from;
    const partial = now.getTime() < bounds.to.getTime();
    const to = partial ? now : bounds.to;
    const fromDate = limaDateOf(from);
    const lastDate = limaDateOf(new Date(bounds.to.getTime() - 1));

    // Resúmenes diarios de los días del mes hasta ayer (ensureRange recorta).
    await this.rollups.ensureRange(fromDate, lastDate, now);

    // --- Inventario del cliente ---
    const serverRows = await this.servers.find({ where: { clientId }, order: { id: 'ASC' } });
    const serverIds = serverRows.map((s) => n(s.id));
    const allServices = serverIds.length
      ? await this.services.find({ where: { serverId: In(serverIds) }, order: { id: 'ASC' } })
      : [];
    const allServiceIds = allServices.map((s) => n(s.id));

    // Incidentes de servicio (hijos o sueltos) del mes.
    const svcIncidents = allServiceIds.length
      ? await this.incidents.find({ where: this.overlapping(from, to, { serviceId: In(allServiceIds) }) })
      : [];
    const withIncidents = new Set(svcIncidents.map((i) => n(i.serviceId)));
    // No archivados (y que ya existían en el período), más los archivados con incidentes en el mes.
    const services = allServices.filter(
      (s) =>
        withIncidents.has(n(s.id)) ||
        (s.status !== 'ARCHIVED' && (!s.createdAt || new Date(s.createdAt).getTime() < to.getTime())),
    );
    const reportedServerIds = new Set(services.map((s) => n(s.serverId)));
    const servers = serverRows.filter((s) => s.status !== 'ARCHIVED' || reportedServerIds.has(n(s.id)));
    const includedServerIds = servers.map((s) => n(s.id));
    const serviceIds = services.map((s) => n(s.id));

    const upgradedAt = new Map<number, Date>();
    if (svcIncidents.length) {
      const ups = await this.events.find({
        where: { incidentId: In(svcIncidents.map((i) => n(i.id))), type: 'UPGRADED_TO_DOWN' },
        order: { at: 'ASC' },
      });
      for (const e of ups) if (!upgradedAt.has(n(e.incidentId))) upgradedAt.set(n(e.incidentId), new Date(e.at));
    }

    // Incidentes de primer nivel: de servidor o de servicio suelto.
    const tops = includedServerIds.length
      ? await this.incidents.find({
          where: this.overlapping(from, to, { serverId: In(includedServerIds), parentId: IsNull() }),
          order: { firstFailureAt: 'ASC', id: 'ASC' },
        })
      : [];
    const topIds = tops.map((t) => n(t.id));
    const children = topIds.length ? await this.incidents.find({ where: { parentId: In(topIds) } }) : [];
    const serviceName = new Map(allServices.map((s) => [n(s.id), s.name]));
    const codes = await ticketCodesForIncidents(this.incidents, this.tickets, tops);
    const evidence = await this.evidence.listForIncidents([...topIds, ...children.map((c) => n(c.id))]);

    const topIncidents: ReportTopIncident[] = tops.map((t) => {
      const id = n(t.id);
      const kids = children.filter((c) => n(c.parentId) === id);
      const sid = nOrNull(t.serviceId);
      const names =
        sid !== null
          ? [serviceName.get(sid) ?? `Servicio ${sid}`]
          : [...new Set(kids.map((c) => serviceName.get(n(c.serviceId))).filter((x): x is string => !!x))];
      const ev = [id, ...kids.map((c) => n(c.id))]
        .flatMap((k) => evidence.get(k) ?? [])
        .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime() || a.id - b.id);
      return {
        id,
        serviceId: sid,
        serverId: n(t.serverId),
        kind: t.kind,
        serviceNames: names,
        firstFailureAt: new Date(t.firstFailureAt),
        recoveredAt: t.recoveredAt ? new Date(t.recoveredAt) : null,
        ticketId: nOrNull(t.ticketId),
        ticketCode: codes.get(id) ?? null,
        evidence: ev.map((e) => ({ id: n(e.id), origin: e.origin, capturedAt: new Date(e.capturedAt), fileName: e.fileName })),
      };
    });

    const maintenance = (
      await this.maintenance.find({ where: { startsAt: LessThan(to), endsAt: MoreThan(from) }, order: { startsAt: 'ASC', id: 'ASC' } })
    ).map(toMaintenanceWindow);

    const rollupRows = serviceIds.length
      ? await this.rollupRows.find({ where: { serviceId: In(serviceIds), date: Between(fromDate, lastDate) } })
      : [];
    const gapRows = await this.gaps.find({ where: { date: Between(fromDate, lastDate) }, order: { startedAt: 'ASC' } });
    const agentRows = includedServerIds.length
      ? await this.agentRollups.find({ where: { serverId: In(includedServerIds), date: Between(fromDate, lastDate) } })
      : [];
    const probeRows = await this.probes.find({ order: { id: 'ASC' } });
    const systemName = new Map((await this.clientSystems.listByClient(clientId)).map((cs) => [n(cs.id), cs.name]));

    const data = computeAvailabilityReport({
      client: { id: n(client.id), name: client.razonSocial },
      month,
      from,
      to,
      partial,
      generatedAt: now,
      servers: servers.map((s) => ({ id: n(s.id), name: s.name })),
      services: services.map((s) => ({
        id: n(s.id),
        name: s.name,
        serverId: n(s.serverId),
        systemName: s.systemId === null || s.systemId === undefined ? null : (systemName.get(n(s.systemId)) ?? null),
        criticality: s.criticality,
      })),
      probes: probeRows.map((p) => ({ id: n(p.id), code: p.code, kind: p.kind })),
      incidents: svcIncidents.map((i) => ({
        id: n(i.id),
        serviceId: n(i.serviceId),
        kind: i.kind,
        firstFailureAt: new Date(i.firstFailureAt),
        recoveredAt: i.recoveredAt ? new Date(i.recoveredAt) : null,
        upgradedAt: upgradedAt.get(n(i.id)) ?? null,
      })),
      topIncidents,
      maintenance,
      rollups: rollupRows.map((r) => ({
        serviceId: n(r.serviceId),
        probeId: n(r.probeId),
        date: String(r.date),
        expected: n(r.expected),
        executed: n(r.executed),
        latencyHist: r.latencyHist ?? [],
      })),
      gaps: gapRows.map((g) => ({
        probeId: n(g.probeId),
        cause: g.cause,
        startedAt: new Date(g.startedAt),
        endedAt: new Date(g.endedAt),
        date: String(g.date),
      })),
      agentRollups: agentRows.map((a) => ({
        serverId: n(a.serverId),
        date: String(a.date),
        cpuHist: a.cpuHist ?? [],
        ramHist: a.ramHist ?? [],
        disksClose: a.disksClose ?? [],
      })),
    });

    // Una fila por (cliente, mes): regenerar reemplaza la versión anterior.
    await this.reports.upsert({ clientId, month, partial, generatedAt: now, generatedBy: by, data }, ['clientId', 'month']);
    return data;
  }
}
