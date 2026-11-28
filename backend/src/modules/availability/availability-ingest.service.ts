import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, IsNull, ObjectLiteral, Repository } from 'typeorm';
import { PROBE_REFERENCES } from './availability.constants';
import { CheckResult, DEFAULT_SCHEDULE, intervalMsAt, ProbeSignal, ScheduleConfig, ServiceTarget } from './core';
import { CombinedStateRow } from './domain/combined-state';
import { buildCombinedRows } from './domain/combined-state-builder';
import { ServerAlert, serverAlertsFor } from './domain/server-alerts';
import { latestAgentDisks } from './domain/agent-disks-repo';
import { MonitorAgentSample } from './entities/monitor-agent-sample.entity';
import { activeMaintenanceWindows } from './domain/maintenance-repo';
import { MaintenanceWindow } from './domain/maintenance';
import { MonitorMaintenance } from './entities/monitor-maintenance.entity';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorProbeOrder } from './entities/monitor-probe-order.entity';
import { MonitorProbeSignal } from './entities/monitor-probe-signal.entity';
import { MonitorProbeState } from './entities/monitor-probe-state.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorServer } from './entities/monitor-server.entity';
import { MonitorService } from './entities/monitor-service.entity';

export interface ProbeBatch {
  checks: CheckResult[];
  signals: ProbeSignal[];
  version: string;
}

export interface AcceptBatchResult {
  acceptedChecks: number;
  duplicateChecks: number;
  acceptedSignals: number;
  duplicateSignals: number;
}

export interface SyncResponse {
  configVersion: string;
  /** null si la `configVersion` que mandó la sonda sigue vigente. */
  config: { services: ServiceTarget[]; schedule: ScheduleConfig; references: ServiceTarget[] } | null;
  orders: { id: number; serviceId: number; kind: 'MANUAL' | 'CROSS' }[];
  state: CombinedStateRow[];
  /** Avisos de agente (mudo, disco bajo) de los servidores `ACTIVE`. */
  serverAlerts: ServerAlert[];
}

const toTarget = (s: MonitorService): ServiceTarget => ({
  id: Number(s.id),
  protocol: s.protocol,
  target: s.target,
  port: s.port === null || s.port === undefined ? null : Number(s.port),
  latencyThresholdMs: Number(s.latencyThresholdMs),
  // Los pings de red se miden cada minuto todo el día (alerta de latencia por hora).
  ...(s.protocol === 'ICMP' ? { intervalMin: PING_INTERVAL_MIN } : {}),
});

/** JSON canónico: claves en orden fijo, para que la huella no dependa del orden de las columnas. */
const canonicalTarget = (t: ServiceTarget) => [t.id, t.protocol, t.target, t.port, t.latencyThresholdMs, t.intervalMin ?? null];

export const PING_INTERVAL_MIN = 1;
const canonicalSchedule = (s: ScheduleConfig) => [s.dayStartHour, s.nightStartHour, s.dayIntervalMin, s.nightIntervalMin];

/** Recibe lo que mandan las sondas y les entrega configuración, órdenes y estado. */
@Injectable()
export class AvailabilityIngestService {
  constructor(
    @InjectRepository(MonitorProbe) private readonly probes: Repository<MonitorProbe>,
    @InjectRepository(MonitorCheck) private readonly checks: Repository<MonitorCheck>,
    @InjectRepository(MonitorProbeSignal) private readonly signals: Repository<MonitorProbeSignal>,
    @InjectRepository(MonitorProbeOrder) private readonly orders: Repository<MonitorProbeOrder>,
    @InjectRepository(MonitorProbeState) private readonly states: Repository<MonitorProbeState>,
    @InjectRepository(MonitorService) private readonly services: Repository<MonitorService>,
    @InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>,
    @InjectRepository(MonitorIncident) private readonly incidents: Repository<MonitorIncident>,
    // Opcional: el worker (kubo-01) solo mide y no registra `MonitorMaintenance`; sin él, `maintenance` va en false.
    @Optional() @InjectRepository(MonitorMaintenance) private readonly maintenance?: Repository<MonitorMaintenance>,
    // Opcional por lo mismo: el worker no registra las muestras del agente; sin ellas no hay `DISK_LOW`.
    @Optional() @InjectRepository(MonitorAgentSample) private readonly agentSamples?: Repository<MonitorAgentSample>,
  ) {}

  /**
   * Idempotente por `(probe_id, id)` y `(probe_id, uuid)` (`INSERT IGNORE`);
   * los aceptados salen de `affectedRows`, que en MySQL no cuenta los
   * ignorados. `received_at` es la hora de la central: el reloj de la sonda
   * solo se usa para estimar `clock_skew_ms`. También la llama el worker, en
   * proceso, para la sonda `kubo-01`.
   */
  async acceptBatch(probe: MonitorProbe, batch: ProbeBatch, receivedAt: Date): Promise<AcceptBatchResult> {
    const probeId = Number(probe.id);

    const checkRows = batch.checks.map((c) => ({
      probeId,
      id: c.id,
      serviceId: c.serviceId,
      kind: c.kind,
      cycleAt: new Date(c.cycleAt),
      startedAt: new Date(c.startedAt),
      durationMs: c.durationMs,
      ok: c.ok,
      errorCode: c.errorCode,
      httpStatus: c.httpStatus,
      orderId: c.orderId,
      receivedAt,
    }));
    const signalRows = batch.signals.map((s) => ({
      uuid: s.id,
      probeId,
      serviceId: s.serviceId,
      type: s.type,
      at: new Date(s.at),
      firstFailureAt: s.firstFailureAt ? new Date(s.firstFailureAt) : null,
      receivedAt,
      processedAt: null,
      awaitingCrossUntil: null,
      crossOrderId: null,
    }));

    // Los ya recibidos no cuentan para el desfase ni para el estado (un reenvío no cambia nada).
    const known = checkRows.length
      ? new Set((await this.checks.find({ where: { probeId, id: In(checkRows.map((c) => c.id)) } })).map((c) => c.id))
      : new Set<string>();
    const newRows = checkRows.filter((c) => !known.has(c.id));

    const acceptedChecks = await this.insertIgnore(this.checks, MonitorCheck, checkRows);
    const acceptedSignals = await this.insertIgnore(this.signals, MonitorProbeSignal, signalRows);

    const patch: Partial<MonitorProbe> = { lastSeenAt: receivedAt, version: batch.version };
    const skew = this.clockSkewMs(newRows, receivedAt);
    if (skew !== null) patch.clockSkewMs = skew;
    const effectiveSkew = skew ?? (probe.clockSkewMs === null || probe.clockSkewMs === undefined ? 0 : Number(probe.clockSkewMs));
    await this.probes.update(probeId, patch);
    Object.assign(probe, patch);

    await this.updateProbeStates(probeId, newRows, receivedAt, effectiveSkew);

    const orderIds = [...new Set(checkRows.map((c) => c.orderId).filter((id): id is number => id !== null))];
    if (orderIds.length > 0) {
      await this.orders.update({ id: In(orderIds), probeId, doneAt: IsNull() }, { doneAt: receivedAt });
    }

    return {
      acceptedChecks,
      duplicateChecks: checkRows.length - acceptedChecks,
      acceptedSignals,
      duplicateSignals: signalRows.length - acceptedSignals,
    };
  }

  async sync(probe: MonitorProbe, configVersion: string | null): Promise<SyncResponse> {
    const now = new Date();
    const activeServices = await this.services.find({ where: { status: 'ACTIVE' } });
    const targets = activeServices.map(toTarget).sort((a, b) => a.id - b.id);
    const schedule = DEFAULT_SCHEDULE;
    const references = PROBE_REFERENCES.map((r) => ({ ...r }));
    // Una sola lectura de ventanas activas para el estado y los avisos de servidor.
    const maintenance = this.maintenance ? await activeMaintenanceWindows(this.maintenance, now) : [];

    const current = createHash('sha256')
      .update(JSON.stringify({ s: targets.map(canonicalTarget), c: canonicalSchedule(schedule), r: references.map(canonicalTarget) }))
      .digest('hex');

    return {
      configVersion: current,
      config: configVersion === current ? null : { services: targets, schedule, references },
      orders: await this.takeOrders(Number(probe.id), now),
      state: await this.combinedState(activeServices, schedule, now, maintenance),
      serverAlerts: await this.serverAlerts(now, maintenance),
    };
  }

  /**
   * Avisos de servidor para el widget: solo servidores `ACTIVE`; los que no tienen token
   * no avisan, ni los cubiertos por un mantenimiento del servidor.
   */
  private async serverAlerts(now: Date, maintenance: MaintenanceWindow[]): Promise<ServerAlert[]> {
    const servers = await this.servers.find({ where: { status: 'ACTIVE' }, order: { id: 'ASC' } });
    const withAgent = servers.filter((s) => s.agentTokenHash).map((s) => Number(s.id));
    const disks = this.agentSamples ? await latestAgentDisks(this.agentSamples, withAgent) : new Map();
    return serverAlertsFor(
      servers.map((s) => ({
        id: Number(s.id),
        name: s.name,
        hasAgent: !!s.agentTokenHash,
        agentLastSeenAt: s.agentLastSeenAt ?? null,
        agentTokenCreatedAt: s.agentTokenCreatedAt ?? null,
        lastDisks: disks.get(Number(s.id)) ?? null,
      })),
      now,
      maintenance,
    );
  }

  /** Las órdenes pendientes de la sonda, marcadas como entregadas: cada una sale una sola vez. */
  private async takeOrders(probeId: number, now: Date): Promise<SyncResponse['orders']> {
    const pending = await this.orders.find({ where: { probeId, takenAt: IsNull() }, order: { id: 'ASC' } });
    if (pending.length === 0) return [];
    const res = await this.orders.update({ id: In(pending.map((o) => o.id)), takenAt: IsNull() }, { takenAt: now });
    // Si otra petición ya las tomó entre medias, no se entregan dos veces.
    if (res.affected !== undefined && res.affected !== pending.length) {
      const stillMine = await this.orders.find({ where: { id: In(pending.map((o) => o.id)), takenAt: now } });
      const mine = new Set(stillMine.map((o) => Number(o.id)));
      return this.toOrders(pending.filter((o) => mine.has(Number(o.id))));
    }
    return this.toOrders(pending);
  }

  private toOrders(rows: MonitorProbeOrder[]): SyncResponse['orders'] {
    return rows.map((o) => ({ id: Number(o.id), serviceId: Number(o.serviceId), kind: o.kind }));
  }

  private async combinedState(
    activeServices: MonitorService[],
    schedule: ScheduleConfig,
    now: Date,
    maintenance: MaintenanceWindow[],
  ): Promise<CombinedStateRow[]> {
    if (activeServices.length === 0) return [];
    const [servers, probes, states, incidents] = await Promise.all([
      this.servers.find(),
      this.probes.find(),
      this.states.find(),
      this.incidents.find({ where: { recoveredAt: IsNull() } }),
    ]);
    // `ticketCode` lo completa `AvailabilitySyncService` (solo backend; el worker no tiene tickets).
    return buildCombinedRows({ services: activeServices, servers, probes, states, openIncidents: incidents, schedule, now, maintenance });
  }

  private async insertIgnore(repo: Repository<any>, entity: new () => ObjectLiteral, rows: ObjectLiteral[]): Promise<number> {
    if (rows.length === 0) return 0;
    const res = await repo.createQueryBuilder().insert().into(entity).values(rows).orIgnore().execute();
    return Number((res.raw as { affectedRows?: number })?.affectedRows ?? 0);
  }

  /**
   * Desfase del reloj de la sonda: MÍNIMO de `(received_at − started_at) − duration_ms`
   * (negativo si la sonda va adelantada) sobre los checks NUEVOS del lote (no los
   * duplicados). Lo viejo de una cola reenviada se distingue con el reloj de la PROPIA
   * sonda, no con el de la central: solo cuentan los checks a menos de 2 intervalos del
   * más reciente del lote (un reloj lento o un salto de NTP no los descarta). El mínimo
   * es el de menos retraso de envío, el más cercano al desfase real. Sin checks nuevos
   * devuelve null y `clock_skew_ms` queda como estaba.
   */
  private clockSkewMs(rows: { startedAt: Date; durationMs: number }[], receivedAt: Date): number | null {
    if (rows.length === 0) return null;
    const maxSpanMs = 2 * intervalMsAt(receivedAt, DEFAULT_SCHEDULE);
    const newestStart = Math.max(...rows.map((r) => r.startedAt.getTime()));
    const diffs = rows
      .filter((r) => newestStart - r.startedAt.getTime() <= maxSpanMs)
      .map((r) => receivedAt.getTime() - r.startedAt.getTime() - r.durationMs);
    return Math.round(Math.min(...diffs));
  }

  /**
   * Último resultado por servicio. `last_check_at` se guarda en hora de la central:
   * `started_at + skew`, sin pasar de `received_at` (la central compara con su `now`, y
   * un reloj de sonda adelantado, atrasado o corregido por NTP no debe congelar ni
   * falsear el estado). Con ese mismo instante se ordena, así que un lote que llega
   * después siempre gana. `last_latency_ms` solo sale de checks OK.
   */
  private async updateProbeStates(
    probeId: number,
    rows: { serviceId: number; startedAt: Date; durationMs: number; ok: boolean }[],
    receivedAt: Date,
    skewMs: number,
  ): Promise<void> {
    const central = (c: { startedAt: Date }) => Math.min(c.startedAt.getTime() + skewMs, receivedAt.getTime());
    const latest = new Map<number, (typeof rows)[number]>();
    const latestOk = new Map<number, (typeof rows)[number]>();
    for (const c of rows) {
      const prev = latest.get(c.serviceId);
      if (!prev || c.startedAt.getTime() >= prev.startedAt.getTime()) latest.set(c.serviceId, c);
      const prevOk = latestOk.get(c.serviceId);
      if (c.ok && (!prevOk || c.startedAt.getTime() >= prevOk.startedAt.getTime())) latestOk.set(c.serviceId, c);
    }
    for (const [serviceId, c] of latest) {
      const at = central(c);
      const okRow = latestOk.get(serviceId);
      const fields: Partial<MonitorProbeState> = { lastCheckAt: new Date(at), lastOk: c.ok };
      if (okRow) fields.lastLatencyMs = okRow.durationMs;
      const existing = await this.states.findOne({ where: { serviceId, probeId } });
      if (!existing) {
        // `state` lo gobierna el evaluador (Task 9) con las señales; hasta entonces, OK.
        await this.insertIgnore(this.states, MonitorProbeState, [
          { serviceId, probeId, state: 'OK', lastLatencyMs: null, ...fields, updatedAt: receivedAt },
        ]);
      } else if (!existing.lastCheckAt || existing.lastCheckAt.getTime() < at) {
        await this.states.update({ serviceId, probeId }, { ...fields, updatedAt: receivedAt });
      }
    }
  }
}
