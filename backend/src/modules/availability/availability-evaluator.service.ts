import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual, MoreThan, MoreThanOrEqual, Between } from 'typeorm';
import { formatPeruDateTime } from '../../common/peru-date-time';
import { isDuplicateEntry } from '../../common/db-errors';
import { AvailabilityTicketsService } from './availability-tickets.service';
import { DEFAULT_SCHEDULE, intervalMsAt, TrackerState } from './core';
import { diagnose } from './domain/diagnose';
import { CROSS_TIMEOUT_MS, formatDuration, recoveryCloses } from './domain/incident-rules';
import { MonitorCheck } from './entities/monitor-check.entity';
import { MonitorIncident } from './entities/monitor-incident.entity';
import { MonitorOfficeOutage } from './entities/monitor-office-outage.entity';
import { MonitorProbeOrder } from './entities/monitor-probe-order.entity';
import { MonitorProbeSignal } from './entities/monitor-probe-signal.entity';
import { MonitorProbeState } from './entities/monitor-probe-state.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorService } from './entities/monitor-service.entity';
import { openFailureIncident, upgradeToDown } from './evaluator/incident-opener';
import {
  addEvent,
  closeIncident,
  insertIncident,
  isFailureKind,
  num,
  openChildrenOf,
  openIncidentOf,
  PostCommitAction,
} from './evaluator/incident-store';
import { TicketSync } from './evaluator/ticket-sync';
import { IncidentCloser } from './incident-closer';

const PAGE = 200;

interface TickContext {
  now: Date;
  probes: Map<number, MonitorProbe>;
  office: MonitorProbe | null;
  dc: MonitorProbe | null;
  /** Incidentes cuyo ticket ya se intentó en este tick. */
  attempted: Set<number>;
}

interface Outcome {
  /** false = la señal espera el cruce y retiene las siguientes de su sonda y servicio. */
  processed: boolean;
  actions: PostCommitAction[];
}

const SERVICE_PAUSED_TEXT = 'Servicio pausado';

/**
 * Convierte las señales de las sondas en incidentes (spec «Cruce de sondas»,
 * «Caída del internet de la oficina», «Degradación», «Recuperación»).
 *
 * Cada señal pendiente se procesa en orden de `id` y en su propia
 * transacción, que también la marca procesada: reprocesarla tras un
 * reinicio no duplica nada (y las claves únicas de incidentes abiertos lo
 * garantizan en la base). Una señal que espera el cruce queda sin procesar
 * y retiene las siguientes de la misma sonda y servicio, para no adelantar,
 * por ejemplo, su RECOVERED. Los tickets y el pedido de cruce al worker se
 * hacen después de confirmar la transacción.
 *
 * `monitor_probe_states.state` lo gobierna este servicio; la ingesta solo
 * crea la fila y actualiza `last_check_at`/`last_ok`/`last_latency_ms`.
 */
@Injectable()
export class AvailabilityEvaluatorService extends IncidentCloser {
  private readonly logger = new Logger(AvailabilityEvaluatorService.name);
  private readonly ticketSync: TicketSync;

  constructor(
    private readonly ds: DataSource,
    tickets: AvailabilityTicketsService,
  ) {
    super();
    this.ticketSync = new TicketSync(ds, tickets, this.logger);
  }

  async tick(now: Date): Promise<void> {
    const probes = await this.ds.manager.getRepository(MonitorProbe).find();
    const ctx: TickContext = {
      now,
      probes: new Map(probes.map((p) => [num(p.id), p])),
      office: probes.find((p) => p.kind === 'OFFICE') ?? null,
      dc: probes.find((p) => p.kind === 'DATACENTER') ?? null,
      attempted: new Set(),
    };
    const held = new Set<string>();
    let lastId = 0;
    for (;;) {
      const page = await this.ds.manager.getRepository(MonitorProbeSignal).find({
        where: { processedAt: IsNull(), id: MoreThan(lastId) },
        order: { id: 'ASC' },
        take: PAGE,
      });
      for (const s of page) {
        lastId = num(s.id);
        const key = s.serviceId === null ? null : `${num(s.probeId)}|${num(s.serviceId)}`;
        if (key && held.has(key)) continue;
        let outcome: Outcome;
        try {
          outcome = await this.ds.transaction((m) => this.handle(m, s, ctx));
        } catch (e) {
          this.logger.error(`Señal ${s.id} (${s.type}) no procesada: ${(e as Error).message}`);
          if (key) held.add(key);
          continue;
        }
        if (!outcome.processed && key) held.add(key);
        await this.runActions(outcome.actions, ctx);
      }
      if (page.length < PAGE) break;
    }
    await this.ticketSync.sweep(now, ctx.attempted);
  }

  /** Cierra los incidentes abiertos de servicios pausados o archivados, sin evento RECOVERED. */
  async closeForPause(serviceIds: number[], actorUserId: number): Promise<void> {
    if (serviceIds.length === 0) return;
    const now = new Date();
    const actions = await this.ds.transaction(async (m) => {
      const open = await m.getRepository(MonitorIncident).find({ where: { serviceId: In(serviceIds), recoveredAt: IsNull() } });
      const owners = new Set<number>();
      for (const inc of open) {
        const id = num(inc.id);
        await closeIncident(m, id, now, 'SERVICE_PAUSED');
        await addEvent(m, id, now, 'SERVICE_PAUSED', { message: SERVICE_PAUSED_TEXT }, actorUserId);
        if (!isFailureKind(inc.kind)) continue;
        let owner = id;
        if (inc.parentId !== null) {
          owner = num(inc.parentId);
          if ((await openChildrenOf(m, owner)).length === 0) {
            await closeIncident(m, owner, now, 'SERVICE_PAUSED');
            await addEvent(m, owner, now, 'SERVICE_PAUSED', { message: SERVICE_PAUSED_TEXT }, actorUserId);
          }
        }
        owners.add(owner);
      }
      return [...owners].map<PostCommitAction>((incidentId) => ({
        type: 'COMMENT',
        incidentId,
        text: `${SERVICE_PAUSED_TEXT}: se cierra su incidente sin recuperación medida.`,
      }));
    });
    await this.runActions(actions, { now, attempted: new Set() });
  }

  private async runActions(actions: PostCommitAction[], ctx: Pick<TickContext, 'now' | 'attempted'>): Promise<void> {
    for (const a of actions) {
      await this.ticketSync.apply(a, ctx.now, ctx.attempted);
    }
  }

  private async handle(m: EntityManager, s: MonitorProbeSignal, ctx: TickContext): Promise<Outcome> {
    const done = async (actions: PostCommitAction[] = []): Promise<Outcome> => {
      const res = await m.getRepository(MonitorProbeSignal).update({ id: num(s.id), processedAt: IsNull() }, { processedAt: ctx.now });
      // Otra ejecución la procesó entre medias: se deshace todo lo de esta.
      if (res.affected === 0) throw new Error('señal ya procesada');
      return { processed: true, actions };
    };
    const probe = ctx.probes.get(num(s.probeId));
    if (!probe) {
      this.logger.warn(`Señal ${s.id} de una sonda desconocida (${s.probeId})`);
      return done();
    }
    const at = this.centralAt(s.at, s, probe);

    if (s.type === 'OFFICE_OUTAGE_START' || s.type === 'OFFICE_OUTAGE_END') {
      if (probe.kind === 'OFFICE') await this.officeOutage(m, num(probe.id), s.type === 'OFFICE_OUTAGE_START', at);
      return done();
    }
    if (s.serviceId === null) return done();
    const serviceId = num(s.serviceId);
    const probeId = num(probe.id);

    switch (s.type) {
      case 'VERIFYING':
        await this.setState(m, probeId, serviceId, 'VERIFYING', ctx.now);
        return done();
      case 'TRANSIENT_FAILURE':
        // Toda vuelta a OK reevalúa la recuperación: la otra sonda pudo quedar esperando a esta.
        await this.setState(m, probeId, serviceId, 'OK', ctx.now);
        return done(await this.recover(m, serviceId, at, ctx));
      case 'DEGRADED':
        await this.setState(m, probeId, serviceId, 'DEGRADED', ctx.now);
        if (probe.kind === 'OFFICE') await this.openDegraded(m, serviceId, at, ctx.now);
        return done();
      case 'DEGRADATION_CLEARED':
        await this.setState(m, probeId, serviceId, 'OK', ctx.now);
        if (probe.kind === 'OFFICE') await this.closeDegraded(m, serviceId, at, ctx.now);
        return done(await this.recover(m, serviceId, at, ctx));
      case 'RECOVERED':
        await this.setState(m, probeId, serviceId, 'OK', ctx.now);
        return done(await this.recover(m, serviceId, at, ctx));
      case 'CONFIRMED_FAILURE':
        return this.confirmed(m, s, probe, serviceId, at, ctx, done);
      default:
        return done();
    }
  }

  private async confirmed(
    m: EntityManager,
    s: MonitorProbeSignal,
    probe: MonitorProbe,
    serviceId: number,
    at: Date,
    ctx: TickContext,
    done: (actions?: PostCommitAction[]) => Promise<Outcome>,
  ): Promise<Outcome> {
    const reporter = probe.kind;
    if (s.awaitingCrossUntil === null) await this.setState(m, num(probe.id), serviceId, 'FAILED', ctx.now);
    const service = await m.getRepository(MonitorService).findOne({ where: { id: serviceId } });
    if (!service || service.status !== 'ACTIVE') return done();

    const open = await openIncidentOf(m, serviceId);
    if (open && isFailureKind(open.kind)) {
      if (reporter === 'DATACENTER' && open.kind === 'ROUTE') return done(await upgradeToDown(m, open, service, ctx.now));
      return done();
    }

    const officeOutage = await this.officeOutageAt(m, at, ctx);
    // Durante una caída de oficina sus fallos no son incidentes (también si la caída llegó después en el lote).
    if (reporter === 'OFFICE' && officeOutage) return done();

    let crossOk: boolean | null = null;
    if (!(reporter === 'DATACENTER' && officeOutage)) {
      if (s.awaitingCrossUntil === null) return this.requestCross(m, s, reporter, serviceId, ctx);
      const cross = await this.crossResult(m, s, reporter, serviceId, ctx);
      if (cross === undefined && ctx.now.getTime() < s.awaitingCrossUntil.getTime()) return { processed: false, actions: [] };
      crossOk = cross ?? null;
    }

    const diagnosis = diagnose({ reporter, crossOk, officeOutage });
    if (diagnosis.kind === 'NONE') {
      this.logger.warn(`${diagnosis.label}: ${probe.code} confirmó el fallo de ${service.name} (servicio ${serviceId}) y la oficina responde`);
      return done();
    }
    const firstFailureAt = s.firstFailureAt ? this.centralAt(s.firstFailureAt, s, probe) : at;
    return done(
      await openFailureIncident(m, {
        service,
        diagnosis,
        firstFailureAt,
        confirmedAt: at,
        now: ctx.now,
        detail: { reporter, crossOk, officeOutage, signalId: num(s.id) },
      }),
    );
  }

  /**
   * Pide el cruce a la OTRA sonda con una orden CROSS en monitor_probe_orders (la
   * recoge la oficina por su sync, o el worker kubo-01 por sondeo) y deja la señal
   * esperando 2 min. El resultado se reconoce por order_id = cross_order_id.
   */
  private async requestCross(
    m: EntityManager,
    s: MonitorProbeSignal,
    reporter: 'OFFICE' | 'DATACENTER',
    serviceId: number,
    ctx: TickContext,
  ): Promise<Outcome> {
    const awaitingCrossUntil = new Date(ctx.now.getTime() + CROSS_TIMEOUT_MS);
    const signals = m.getRepository(MonitorProbeSignal);
    const target = reporter === 'OFFICE' ? ctx.dc : ctx.office;
    let crossOrderId: number | null = null;
    if (target) {
      const res = await m.getRepository(MonitorProbeOrder).insert({
        probeId: num(target.id),
        serviceId,
        kind: 'CROSS',
        createdAt: ctx.now,
        takenAt: null,
        doneAt: null,
      });
      crossOrderId = num(res.identifiers[0].id);
    }
    await signals.update({ id: num(s.id) }, { awaitingCrossUntil, crossOrderId });
    return { processed: false, actions: [] };
  }

  /** Resultado del cruce si ya llegó; `undefined` si no. */
  private async crossResult(
    m: EntityManager,
    s: MonitorProbeSignal,
    reporter: 'OFFICE' | 'DATACENTER',
    serviceId: number,
    ctx: TickContext,
  ): Promise<boolean | undefined> {
    const target = reporter === 'OFFICE' ? ctx.dc : ctx.office;
    if (!target || s.crossOrderId === null) return undefined;
    const check = await m.getRepository(MonitorCheck).findOne({ where: { probeId: num(target.id), orderId: num(s.crossOrderId) } });
    return check ? Boolean(check.ok) : undefined;
  }

  private async recover(m: EntityManager, serviceId: number, at: Date, ctx: TickContext): Promise<PostCommitAction[]> {
    const inc = await openIncidentOf(m, serviceId);
    if (!inc || !isFailureKind(inc.kind)) return [];
    const office = (await this.officeOutageAt(m, at, ctx)) ? null : await this.stateOf(m, ctx.office, serviceId);
    const dc = await this.stateOf(m, ctx.dc, serviceId);
    if (!recoveryCloses(inc.kind, office, dc)) return [];

    const id = num(inc.id);
    await closeIncident(m, id, at, 'RECOVERED');
    await addEvent(m, id, ctx.now, 'RECOVERED', { durationMs: at.getTime() - inc.firstFailureAt.getTime() });
    if (inc.parentId === null) return [{ type: 'COMMENT', incidentId: id, text: this.recoveredText(inc, at) }];

    // El padre se cierra con su último hijo, y solo él comenta.
    const parentId = num(inc.parentId);
    if ((await openChildrenOf(m, parentId)).length > 0) return [];
    const parent = await m.getRepository(MonitorIncident).findOne({ where: { id: parentId } });
    if (!parent || parent.recoveredAt !== null) return [];
    await closeIncident(m, parentId, at, 'RECOVERED');
    await addEvent(m, parentId, ctx.now, 'RECOVERED', { durationMs: at.getTime() - parent.firstFailureAt.getTime() });
    return [{ type: 'COMMENT', incidentId: parentId, text: this.recoveredText(parent, at) }];
  }

  private recoveredText(inc: MonitorIncident, at: Date): string {
    const what = inc.serviceId === null ? 'Servidor recuperado' : 'Servicio recuperado';
    return `${what} el ${formatPeruDateTime(at)}. Duración de la caída: ${formatDuration(at.getTime() - inc.firstFailureAt.getTime())}.`;
  }

  private async openDegraded(m: EntityManager, serviceId: number, at: Date, now: Date): Promise<void> {
    const service = await m.getRepository(MonitorService).findOne({ where: { id: serviceId } });
    if (!service || service.status !== 'ACTIVE') return;
    if (await openIncidentOf(m, serviceId)) return;
    let id: number;
    try {
      id = await insertIncident(m, { serviceId, serverId: num(service.serverId), kind: 'DEGRADED', firstFailureAt: at, confirmedAt: at });
    } catch (e) {
      if (isDuplicateEntry(e)) return;
      throw e;
    }
    await addEvent(m, id, now, 'DEGRADED', null);
  }

  private async closeDegraded(m: EntityManager, serviceId: number, at: Date, now: Date): Promise<void> {
    const open = await openIncidentOf(m, serviceId);
    if (!open || open.kind !== 'DEGRADED') return;
    await closeIncident(m, num(open.id), at, 'RECOVERED');
    await addEvent(m, num(open.id), now, 'DEGRADATION_CLEARED', null);
  }

  private async officeOutage(m: EntityManager, probeId: number, start: boolean, at: Date): Promise<void> {
    const repo = m.getRepository(MonitorOfficeOutage);
    const open = await repo.findOne({ where: { probeId, endedAt: IsNull() }, order: { startedAt: 'DESC' } });
    if (!start) {
      if (open) await repo.update({ id: num(open.id) }, { endedAt: at });
      return;
    }
    if (open) return;
    // Destinos que fallaron en la franja que declaró la caída.
    const failed = await m.getRepository(MonitorCheck).find({
      where: {
        probeId,
        ok: false,
        kind: In(['REGULAR', 'RETRY']),
        startedAt: Between(new Date(at.getTime() - intervalMsAt(at, DEFAULT_SCHEDULE)), at),
      },
    });
    const affected = new Set(failed.map((c) => num(c.serviceId)).filter((id) => id > 0)).size;
    await repo.insert({ probeId, startedAt: at, endedAt: null, affectedServices: affected });
  }

  /**
   * ¿Había caída de oficina en `at`? La señal START se emite al evaluar la
   * franja, así que puede llegar hasta una franja después de los fallos que
   * la componen: se admite ese margen.
   */
  private async officeOutageAt(m: EntityManager, at: Date, ctx: TickContext): Promise<boolean> {
    if (!ctx.office) return false;
    const probeId = num(ctx.office.id);
    const startedAt = LessThanOrEqual(new Date(at.getTime() + intervalMsAt(at, DEFAULT_SCHEDULE)));
    const count = await m.getRepository(MonitorOfficeOutage).count({
      where: [
        { probeId, startedAt, endedAt: IsNull() },
        { probeId, startedAt, endedAt: MoreThanOrEqual(at) },
      ],
    });
    return count > 0;
  }

  private async stateOf(m: EntityManager, probe: MonitorProbe | null, serviceId: number): Promise<TrackerState | null> {
    if (!probe) return null;
    const row = await m.getRepository(MonitorProbeState).findOne({ where: { probeId: num(probe.id), serviceId } });
    return row ? row.state : null;
  }

  private async setState(m: EntityManager, probeId: number, serviceId: number, state: TrackerState, now: Date): Promise<void> {
    const repo = m.getRepository(MonitorProbeState);
    const res = await repo.update({ serviceId, probeId }, { state, updatedAt: now });
    if (res.affected) return;
    try {
      await repo.insert({ serviceId, probeId, state, lastCheckAt: null, lastOk: null, lastLatencyMs: null, updatedAt: now });
    } catch (e) {
      // La fila existía con los mismos valores (MySQL no la cuenta como afectada) o la creó la ingesta a la vez.
      if (!isDuplicateEntry(e)) throw e;
      await repo.update({ serviceId, probeId }, { state, updatedAt: now });
    }
  }

  /** Instante de la sonda pasado a hora de la central con su desfase, sin pasar de la recepción. */
  private centralAt(t: Date, s: MonitorProbeSignal, probe: MonitorProbe): Date {
    const skew = probe.clockSkewMs === null || probe.clockSkewMs === undefined ? 0 : Number(probe.clockSkewMs);
    return new Date(Math.min(t.getTime() + skew, s.receivedAt.getTime()));
  }
}
