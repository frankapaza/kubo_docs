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
/** Intentos fallidos (excepción) tras los que una señal se descarta para no retener su clave para siempre. */
export const MAX_SIGNAL_ATTEMPTS = 5;
/** Comprobaciones correctas seguidas que reconcilian un estado sin señal (como la recuperación del tracker). */
const RECONCILE_OK_COUNT = 2;
const STUCK_STATES: TrackerState[] = ['FAILED', 'VERIFYING', 'DEGRADED'];

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
 * `state_changed_at` guarda cuándo lo cambió este servicio por última vez.
 *
 * Resincronización tras reiniciar una sonda: STATE_SYNC (servicio sano según
 * el tracker recién creado) fija OK, cierra la degradación y reevalúa la
 * recuperación; OFFICE_OUTAGE_START/END son idempotentes. Y como red de
 * seguridad, al final de cada tick se reconcilia lo que quedó colgado sin
 * señal (ver `reconcileStates` y `reconcileOutages`).
 *
 * Una señal cuyo procesamiento lanza se reintenta en los ticks siguientes
 * reteniendo su clave; tras `MAX_SIGNAL_ATTEMPTS` intentos se marca procesada
 * con un error en el log (p. ej. un serviceId inexistente) para no bloquear la
 * clave para siempre. El recuento es en memoria: un reinicio lo pone a cero.
 */
@Injectable()
export class AvailabilityEvaluatorService extends IncidentCloser {
  private readonly logger = new Logger(AvailabilityEvaluatorService.name);
  private readonly ticketSync: TicketSync;
  private readonly attempts = new Map<number, number>();

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
          if (await this.failedAttempt(s, e as Error, now)) continue;
          if (key) held.add(key);
          continue;
        }
        this.attempts.delete(num(s.id));
        if (!outcome.processed && key) held.add(key);
        await this.runActions(outcome.actions, ctx);
      }
      if (page.length < PAGE) break;
    }
    await this.reconcileStates(ctx);
    await this.reconcileOutages(ctx);
    await this.ticketSync.sweep(now, ctx.attempted);
  }

  /** Cuenta el intento fallido; true si la señal se ha descartado (marcada procesada). */
  private async failedAttempt(s: MonitorProbeSignal, e: Error, now: Date): Promise<boolean> {
    const id = num(s.id);
    const n = (this.attempts.get(id) ?? 0) + 1;
    if (n < MAX_SIGNAL_ATTEMPTS) {
      this.attempts.set(id, n);
      this.logger.error(`Señal ${s.id} (${s.type}) no procesada (intento ${n}/${MAX_SIGNAL_ATTEMPTS}): ${e.message}`);
      return false;
    }
    this.attempts.delete(id);
    try {
      await this.ds.manager.getRepository(MonitorProbeSignal).update({ id, processedAt: IsNull() }, { processedAt: now });
    } catch (err) {
      this.logger.error(`Señal ${s.id}: no se pudo descartar: ${(err as Error).message}`);
      return false;
    }
    this.logger.error(
      `Señal ${s.id} (${s.type}, sonda ${s.probeId}, servicio ${s.serviceId ?? '-'}) descartada sin incidente tras ${MAX_SIGNAL_ATTEMPTS} intentos: ${e.message}`,
    );
    return true;
  }

  /**
   * Red de seguridad: un estado FAILED/VERIFYING/DEGRADED sin señales pendientes
   * de su (sonda, servicio) cuyas dos comprobaciones más recientes, recibidas
   * después del último cambio de estado, son correctas (y rápidas, si era
   * DEGRADED) pasa a OK como lo haría un RECOVERED/DEGRADATION_CLEARED que no
   * llegó (p. ej. la sonda reinició con la condición abierta).
   */
  private async reconcileStates(ctx: TickContext): Promise<void> {
    const stuck = await this.ds.manager.getRepository(MonitorProbeState).find({ where: { state: In(STUCK_STATES) } });
    for (const row of stuck) {
      const probe = ctx.probes.get(num(row.probeId));
      if (!probe) continue;
      try {
        const actions = await this.ds.transaction((m) => this.reconcileState(m, row, probe, ctx));
        await this.runActions(actions, ctx);
      } catch (e) {
        this.logger.error(`No se pudo reconciliar el estado de ${probe.code} para el servicio ${row.serviceId}: ${(e as Error).message}`);
      }
    }
  }

  private async reconcileState(m: EntityManager, row: MonitorProbeState, probe: MonitorProbe, ctx: TickContext): Promise<PostCommitAction[]> {
    const probeId = num(row.probeId);
    const serviceId = num(row.serviceId);
    const pending = await m.getRepository(MonitorProbeSignal).count({ where: { probeId, serviceId, processedAt: IsNull() } });
    if (pending > 0) return [];
    const since = row.stateChangedAt ?? row.updatedAt;
    const checks = await m.getRepository(MonitorCheck).find({
      where: { probeId, serviceId, receivedAt: MoreThan(since) },
      order: { startedAt: 'DESC' },
      take: RECONCILE_OK_COUNT,
    });
    if (checks.length < RECONCILE_OK_COUNT || !checks.every((c) => Boolean(c.ok))) return [];
    if (row.state === 'DEGRADED') {
      const service = await m.getRepository(MonitorService).findOne({ where: { id: serviceId } });
      const threshold = Number(service?.latencyThresholdMs ?? 1500);
      if (!checks.every((c) => Number(c.durationMs) <= threshold)) return [];
    }
    // Releer dentro de la transacción: otra ejecución pudo cambiarlo.
    const fresh = await m.getRepository(MonitorProbeState).findOne({ where: { probeId, serviceId } });
    if (!fresh || fresh.state !== row.state) return [];

    const at = this.toCentral(checks[0].startedAt, checks[0].receivedAt, probe);
    this.logger.warn(`Estado ${row.state} de ${probe.code} para el servicio ${serviceId} reconciliado a OK sin señal (dos comprobaciones correctas posteriores)`);
    await this.setState(m, probeId, serviceId, 'OK', ctx.now);
    if (row.state === 'DEGRADED' && probe.kind === 'OFFICE') await this.closeDegraded(m, serviceId, at, ctx.now);
    return this.recover(m, serviceId, at, ctx);
  }

  /**
   * Red de seguridad: una caída de oficina abierta se cierra si, sin señales de
   * oficina pendientes, las comprobaciones más recientes de esa sonda (una por
   * servicio, iniciadas más de un intervalo después del inicio de la caída) ya
   * no cumplen la regla de caída: fallan menos de ceil(n/2).
   */
  private async reconcileOutages(ctx: TickContext): Promise<void> {
    const open = await this.ds.manager.getRepository(MonitorOfficeOutage).find({ where: { endedAt: IsNull() } });
    for (const outage of open) {
      const probe = ctx.probes.get(num(outage.probeId));
      if (!probe || probe.kind !== 'OFFICE') continue;
      try {
        await this.ds.transaction((m) => this.reconcileOutage(m, outage, probe, ctx));
      } catch (e) {
        this.logger.error(`No se pudo reconciliar la caída de oficina ${outage.id}: ${(e as Error).message}`);
      }
    }
  }

  private async reconcileOutage(m: EntityManager, outage: MonitorOfficeOutage, probe: MonitorProbe, ctx: TickContext): Promise<void> {
    const probeId = num(probe.id);
    const pending = await m.getRepository(MonitorProbeSignal).count({ where: { probeId, serviceId: IsNull(), processedAt: IsNull() } });
    if (pending > 0) return;
    const after = outage.startedAt.getTime() + intervalMsAt(outage.startedAt, DEFAULT_SCHEDULE);
    // Solo lo reciente (índice por started_at): dos intervalos hacia atrás bastan para una por servicio.
    const from = Math.max(after, ctx.now.getTime() - 2 * intervalMsAt(ctx.now, DEFAULT_SCHEDULE));
    const skew = this.skewOf(probe);
    const recent = await m.getRepository(MonitorCheck).find({
      where: { probeId, kind: In(['REGULAR', 'RETRY']), startedAt: MoreThan(new Date(from - skew)) },
      order: { startedAt: 'DESC' },
    });
    const latest = new Map<number, MonitorCheck>();
    for (const c of recent) {
      const sid = num(c.serviceId);
      if (sid <= 0 || latest.has(sid)) continue;
      if (this.toCentral(c.startedAt, c.receivedAt, probe).getTime() <= after) continue;
      latest.set(sid, c);
    }
    const n = latest.size;
    if (n === 0) return;
    const failed = [...latest.values()].filter((c) => !c.ok).length;
    if (failed >= Math.ceil(n / 2)) return;
    const newest = [...latest.values()].reduce((a, b) => (b.startedAt.getTime() > a.startedAt.getTime() ? b : a));
    const endedAt = this.toCentral(newest.startedAt, newest.receivedAt, probe);
    const res = await m.getRepository(MonitorOfficeOutage).update({ id: num(outage.id), endedAt: IsNull() }, { endedAt });
    if (res.affected) {
      this.logger.warn(`Caída de oficina ${outage.id} cerrada sin señal: ${n - failed} de ${n} servicios responden`);
    }
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
      case 'STATE_SYNC':
        // La sonda reinició y juzga el servicio sano: idempotente con lo que ya hubiera.
        await this.setState(m, probeId, serviceId, 'OK', ctx.now);
        if (probe.kind === 'OFFICE') await this.closeDegraded(m, serviceId, at, ctx.now);
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
    // El estado refleja siempre al tracker de la sonda, aunque luego el fallo se descarte
    // (servicio pausado, caída de oficina): RECOVERED o la reconciliación lo devuelven a OK.
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
    const res = await repo.update({ serviceId, probeId }, { state, updatedAt: now, stateChangedAt: now });
    if (res.affected) return;
    try {
      await repo.insert({ serviceId, probeId, state, lastCheckAt: null, lastOk: null, lastLatencyMs: null, updatedAt: now, stateChangedAt: now });
    } catch (e) {
      // La fila existía con los mismos valores (MySQL no la cuenta como afectada) o la creó la ingesta a la vez.
      if (!isDuplicateEntry(e)) throw e;
      await repo.update({ serviceId, probeId }, { state, updatedAt: now, stateChangedAt: now });
    }
  }

  /** Instante de la sonda pasado a hora de la central con su desfase, sin pasar de la recepción. */
  private centralAt(t: Date, s: MonitorProbeSignal, probe: MonitorProbe): Date {
    return this.toCentral(t, s.receivedAt, probe);
  }

  private toCentral(t: Date, receivedAt: Date, probe: MonitorProbe): Date {
    return new Date(Math.min(t.getTime() + this.skewOf(probe), receivedAt.getTime()));
  }

  private skewOf(probe: MonitorProbe): number {
    return probe.clockSkewMs === null || probe.clockSkewMs === undefined ? 0 : Number(probe.clockSkewMs);
  }
}
