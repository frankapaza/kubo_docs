import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThanOrEqual, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { ClientsService } from '../clients/clients.service';
import { TicketsRepository } from '../tickets/tickets.repository';
import { DEFAULT_SCHEDULE } from './core';
import { CombinedStateRow, CombinedStatus } from './domain/combined-state';
import { buildCombinedRows } from './domain/combined-state-builder';
import { activeMaintenanceWindows } from './domain/maintenance-repo';
import { MonitorMaintenance } from './entities/monitor-maintenance.entity';
import { AvailabilityEvidenceService, EvidenceView } from './availability-evidence.service';
import { toCsv } from './domain/csv';
import { diagnosisFromEvent } from './domain/diagnose';
import { ticketCodesForIncidents } from './incident-ticket-codes';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorIncidentEvent } from './entities/monitor-incident-event.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorProbeOrder } from './entities/monitor-probe-order.entity';
import { MonitorProbeState } from './entities/monitor-probe-state.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';

const badInput = (message: string) => new BadRequestException({ code: 'BAD_INPUT', message });
const notFound = (message: string) => new NotFoundException({ code: 'NOT_FOUND', message });

/** Pausa mínima entre dos comprobaciones manuales del mismo servicio. */
export const MANUAL_CHECK_COOLDOWN_MS = 15_000;
/** Comprobaciones que se muestran por sonda en el detalle, y margen previo al primer fallo. */
const DETAIL_CHECKS_PER_PROBE = 30;
const DETAIL_LEAD_MS = 10 * 60_000;
const NOTE_MAX = 2000;
/** Tipos de evento que guardan el diagnóstico (los mismos que lee `TicketSync.storedDiagnosis`). */
const DIAGNOSIS_EVENTS = ['OPENED', 'REOPENED', 'UPGRADED_TO_DOWN'];

const STATUS_ORDER: CombinedStatus[] = ['DOWN', 'ROUTE', 'VERIFYING', 'DEGRADED', 'NO_DATA', 'OK'];

export interface StateFilter {
  clientId?: number;
  status?: string;
  serverId?: number;
}

/** Tope de filas de la lista de incidentes: por defecto y máximo. */
export const INCIDENT_LIMIT_DEFAULT = 200;
export const INCIDENT_LIMIT_MAX = 500;

export interface IncidentList {
  items: IncidentListRow[];
  /** true si había más incidentes que `limit` (se devuelven los más recientes). */
  truncated: boolean;
}

export interface IncidentFilter {
  limit?: number;
  open?: boolean;
  clientId?: number;
  from?: Date;
  to?: Date;
}

export interface IncidentListRow {
  id: number;
  kind: 'DOWN' | 'ROUTE' | 'DEGRADED';
  serviceName: string | null;
  serverName: string;
  clientName: string;
  firstFailureAt: Date;
  confirmedAt: Date;
  recoveredAt: Date | null;
  durationMinutes: number;
  ticketId: number | null;
  ticketCode: string | null;
  childCount: number;
  parentId: number | null;
  serverId: number;
}

export interface CheckRow {
  id: string;
  serviceId: number;
  kind: string;
  startedAt: Date;
  durationMs: number;
  ok: boolean;
  errorCode: string | null;
  httpStatus: number | null;
}

export interface IncidentDetail {
  incident: IncidentListRow & {
    parentId: number | null;
    serverId: number;
    closeReason: string | null;
    acknowledgedBy: number | null;
    acknowledgedAt: Date | null;
  };
  children: IncidentListRow[];
  events: MonitorIncidentEvent[];
  checks: { office: CheckRow[]; datacenter: CheckRow[] };
  diagnosis: string;
  winmtrTarget: string;
  evidence: EvidenceView[];
}

export interface AckResult {
  incidentId: number;
  acknowledgedBy: number | null;
  acknowledgedAt: Date | null;
}

const n = (v: unknown): number => Number(v);
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** API del personal: estado combinado, comprobación manual e incidentes. */
@Injectable()
export class AvailabilityStateService {
  constructor(
    @InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>,
    @InjectRepository(MonitorService) private readonly services: Repository<MonitorService>,
    @InjectRepository(MonitorProbe) private readonly probes: Repository<MonitorProbe>,
    @InjectRepository(MonitorProbeState) private readonly states: Repository<MonitorProbeState>,
    @InjectRepository(MonitorIncident) private readonly incidents: Repository<MonitorIncident>,
    @InjectRepository(MonitorIncidentEvent) private readonly events: Repository<MonitorIncidentEvent>,
    @InjectRepository(MonitorCheck) private readonly checks: Repository<MonitorCheck>,
    @InjectRepository(MonitorProbeOrder) private readonly orders: Repository<MonitorProbeOrder>,
    private readonly clients: ClientsService,
    private readonly tickets: TicketsRepository,
    @InjectRepository(MonitorMaintenance) private readonly maintenance: Repository<MonitorMaintenance>,
    private readonly evidence: AvailabilityEvidenceService,
  ) {}

  // ---------------------------------------------------------------- estado

  async state(filter: StateFilter): Promise<CombinedStateRow[]> {
    if (filter.status !== undefined && !STATUS_ORDER.includes(filter.status as CombinedStatus)) {
      throw badInput('Estado inválido');
    }
    const now = new Date();
    const [services, servers, probes, states, open, maintenance] = await Promise.all([
      this.services.find({ where: { status: 'ACTIVE' } }),
      this.servers.find(),
      this.probes.find(),
      this.states.find(),
      this.incidents.find({ where: { recoveredAt: IsNull() } }),
      activeMaintenanceWindows(this.maintenance, now),
    ]);
    let rows = buildCombinedRows({ services, servers, probes, states, openIncidents: open, schedule: DEFAULT_SCHEDULE, now, maintenance });
    if (filter.clientId !== undefined) rows = rows.filter((r) => r.clientId === filter.clientId);
    if (filter.serverId !== undefined) rows = rows.filter((r) => r.serverId === filter.serverId);
    if (filter.status !== undefined) rows = rows.filter((r) => r.status === filter.status);

    const codes = await this.ticketCodesFor(open.filter((i) => rows.some((r) => r.incidentId === n(i.id))));
    for (const r of rows) r.ticketCode = r.incidentId === null ? null : (codes.get(r.incidentId) ?? null);

    return rows.sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.serviceName.localeCompare(b.serviceName, 'es'),
    );
  }

  async stateCsv(filter: StateFilter): Promise<string> {
    const rows = await this.state(filter);
    const clientName = await this.clientNames();
    const probe = (v: CombinedStateRow['office']) => (v ? `${v.state}${v.lastLatencyMs === null ? '' : ` (${v.lastLatencyMs} ms)`}` : '');
    return toCsv(
      ['Cliente', 'Servidor', 'Servicio', 'Criticidad', 'Estado', 'Oficina', 'Centro de datos', 'Incidente', 'Ticket'],
      rows.map((r) => [
        clientName.get(r.clientId) ?? '',
        r.serverName,
        r.serviceName,
        r.criticality,
        r.status,
        probe(r.office),
        probe(r.datacenter),
        r.incidentId === null ? '' : String(r.incidentId),
        r.ticketCode ?? '',
      ]),
    );
  }

  // ----------------------------------------------------------- check-now

  async checkNow(serviceId: number): Promise<{ serviceId: number; orders: number }> {
    const svc = await this.services.findOne({ where: { id: serviceId } });
    if (!svc) throw notFound('Servicio no encontrado');
    if (svc.status !== 'ACTIVE') throw badInput('El servicio no está activo');

    const now = new Date();
    const tooMany = () =>
      new HttpException(
        { code: 'TOO_MANY_REQUESTS', message: 'Espera unos segundos antes de volver a comprobar este servicio.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const last = svc.lastManualCheckAt ?? null;
    if (last && now.getTime() - last.getTime() < MANUAL_CHECK_COOLDOWN_MS) throw tooMany();
    const probes = (await this.probes.find()).filter((p) => p.kind === 'OFFICE' || p.kind === 'DATACENTER');
    // Una transacción: si falla una orden, el enfriamiento se deshace y se puede reintentar.
    return this.services.manager.transaction(async (m) => {
      // Compare-and-swap: de dos peticiones simultáneas solo una gana.
      const res = await m.getRepository(MonitorService).update({ id: serviceId, lastManualCheckAt: last ?? IsNull() }, { lastManualCheckAt: now });
      if (res.affected === 0) throw tooMany();
      for (const probe of probes) {
        await m.getRepository(MonitorProbeOrder).insert({ probeId: n(probe.id), serviceId, kind: 'MANUAL', createdAt: now, takenAt: null, doneAt: null });
      }
      return { serviceId, orders: probes.length };
    });
  }

  // ---------------------------------------------------------- incidentes

  async listIncidents(filter: IncidentFilter): Promise<IncidentList> {
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? INCIDENT_LIMIT_DEFAULT), 1), INCIDENT_LIMIT_MAX);
    const where: Record<string, unknown> = {};
    if (filter.open !== undefined) where.recoveredAt = filter.open ? IsNull() : Not(IsNull());
    if (filter.from && filter.to) where.firstFailureAt = Between(filter.from, filter.to);
    else if (filter.from) where.firstFailureAt = MoreThanOrEqual(filter.from);
    else if (filter.to) where.firstFailureAt = LessThanOrEqual(filter.to);
    if (filter.clientId !== undefined) {
      const serverIds = (await this.servers.find({ where: { clientId: filter.clientId } })).map((s) => n(s.id));
      if (serverIds.length === 0) return { items: [], truncated: false };
      where.serverId = In(serverIds);
    }
    // Se pide una de más para saber si la lista quedó recortada.
    const found = await this.incidents.find({ where, order: { firstFailureAt: 'DESC' }, take: limit + 1 });
    const truncated = found.length > limit;
    return { items: await this.toRows(found.slice(0, limit)), truncated };
  }

  async incidentDetail(id: number): Promise<IncidentDetail> {
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw notFound('Incidente no encontrado');
    const children = await this.incidents.find({ where: { parentId: id }, order: { confirmedAt: 'ASC' } });
    const [[row, ...childRows], events, server, evidence] = await Promise.all([
      this.toRows([inc, ...children]),
      this.events.find({ where: { incidentId: id }, order: { at: 'ASC', id: 'ASC' } }),
      this.servers.findOne({ where: { id: n(inc.serverId) } }),
      this.evidence.listForIncidents([id]),
    ]);

    const lastDiagnosis = [...events].filter((e) => DIAGNOSIS_EVENTS.includes(e.type)).sort((a, b) => n(b.id) - n(a.id))[0];
    const serviceIds = inc.serviceId !== null ? [n(inc.serviceId)] : children.map((c) => n(c.serviceId));
    const from = new Date(inc.firstFailureAt.getTime() - DETAIL_LEAD_MS);
    const to = inc.recoveredAt ?? new Date();

    return {
      incident: {
        ...row,
        parentId: nOrNull(inc.parentId),
        serverId: n(inc.serverId),
        closeReason: inc.closeReason,
        acknowledgedBy: nOrNull(inc.acknowledgedBy),
        acknowledgedAt: inc.acknowledgedAt ?? null,
      },
      children: childRows,
      events,
      checks: {
        office: await this.recentChecks('OFFICE', serviceIds, from, to),
        datacenter: await this.recentChecks('DATACENTER', serviceIds, from, to),
      },
      diagnosis: diagnosisFromEvent(inc.kind, lastDiagnosis),
      winmtrTarget: server?.host ?? '',
      evidence: evidence.get(id) ?? [],
    };
  }

  /** Idempotente: la segunda confirmación no crea evento y devuelve lo mismo. */
  async acknowledge(id: number, userId: number): Promise<AckResult> {
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw notFound('Incidente no encontrado');
    if (!inc.acknowledgedAt) {
      const now = new Date();
      // Solo quien gana la actualización registra el evento.
      const res = await this.incidents.update({ id, acknowledgedAt: IsNull() }, { acknowledgedBy: userId, acknowledgedAt: now });
      if (res.affected === 1) {
        await this.events.insert({ incidentId: id, at: now, type: 'ACKNOWLEDGED', detail: null, authorUserId: userId });
      }
    }
    const fresh = (await this.incidents.findOne({ where: { id } })) ?? inc;
    return { incidentId: id, acknowledgedBy: nOrNull(fresh.acknowledgedBy), acknowledgedAt: fresh.acknowledgedAt ?? null };
  }

  async addNote(id: number, text: string, userId: number): Promise<MonitorIncidentEvent> {
    const clean = (text ?? '').trim();
    if (clean.length < 1 || clean.length > NOTE_MAX) throw badInput(`La nota debe tener entre 1 y ${NOTE_MAX} caracteres`);
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw notFound('Incidente no encontrado');
    const at = new Date();
    const res = await this.events.insert({ incidentId: id, at, type: 'NOTE', detail: { text: clean }, authorUserId: userId });
    return { id: n(res.identifiers[0]?.id), incidentId: id, at, type: 'NOTE', detail: { text: clean }, authorUserId: userId };
  }

  // ------------------------------------------------------------- helpers

  private async clientNames(): Promise<Map<number, string>> {
    return new Map((await this.clients.list({})).map((c) => [n(c.id), c.razonSocial]));
  }

  /** Código del ticket de cada incidente: el del padre si es un hijo. */
  private ticketCodesFor(incidents: MonitorIncident[]): Promise<Map<number, string | null>> {
    return ticketCodesForIncidents(this.incidents, this.tickets, incidents);
  }

  private async toRows(found: MonitorIncident[]): Promise<IncidentListRow[]> {
    if (found.length === 0) return [];
    const now = Date.now();
    const [servers, services, clientName, codes, kids] = await Promise.all([
      this.servers.find({ where: { id: In([...new Set(found.map((i) => n(i.serverId)))]) } }),
      this.services.find({ where: { id: In([...new Set(found.map((i) => nOrNull(i.serviceId)).filter((s): s is number => s !== null))]) } }),
      this.clientNames(),
      this.ticketCodesFor(found),
      this.incidents.find({ where: { parentId: In(found.map((i) => n(i.id))) } }),
    ]);
    const serverById = new Map(servers.map((s) => [n(s.id), s]));
    const serviceById = new Map(services.map((s) => [n(s.id), s]));
    const childCount = new Map<number, number>();
    for (const k of kids) childCount.set(n(k.parentId), (childCount.get(n(k.parentId)) ?? 0) + 1);

    return found.map((i) => {
      const server = serverById.get(n(i.serverId));
      const end = i.recoveredAt ? i.recoveredAt.getTime() : now;
      return {
        id: n(i.id),
        kind: i.kind,
        serviceName: i.serviceId === null ? null : (serviceById.get(n(i.serviceId))?.name ?? null),
        serverName: server?.name ?? '',
        clientName: server ? (clientName.get(n(server.clientId)) ?? '') : '',
        firstFailureAt: i.firstFailureAt,
        confirmedAt: i.confirmedAt,
        recoveredAt: i.recoveredAt ?? null,
        durationMinutes: Math.max(0, Math.round((end - i.firstFailureAt.getTime()) / 60_000)),
        ticketId: nOrNull(i.ticketId),
        ticketCode: codes.get(n(i.id)) ?? null,
        childCount: childCount.get(n(i.id)) ?? 0,
        parentId: nOrNull(i.parentId),
        serverId: n(i.serverId),
      };
    });
  }

  /** Las últimas comprobaciones de una sonda en la ventana, en orden cronológico. */
  private async recentChecks(kind: 'OFFICE' | 'DATACENTER', serviceIds: number[], from: Date, to: Date): Promise<CheckRow[]> {
    if (serviceIds.length === 0) return [];
    const probe = (await this.probes.find()).find((p) => p.kind === kind);
    if (!probe) return [];
    const rows = await this.checks.find({
      where: { probeId: n(probe.id), serviceId: In(serviceIds), startedAt: Between(from, to) },
      order: { startedAt: 'DESC' },
      take: DETAIL_CHECKS_PER_PROBE,
    });
    return rows.reverse().map((c) => ({
      id: c.id,
      serviceId: n(c.serviceId),
      kind: c.kind,
      startedAt: c.startedAt,
      durationMs: n(c.durationMs),
      ok: Boolean(c.ok),
      errorCode: c.errorCode ?? null,
      httpStatus: nOrNull(c.httpStatus),
    }));
  }
}
