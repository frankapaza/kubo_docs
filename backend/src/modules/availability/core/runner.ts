// GENERADO — no editar; fuente: packages/monitoring-core/src
// Regenerar con: node scripts/sync-monitoring-core.mjs

import { randomUUID } from 'node:crypto';
import type { CheckFn } from './checks';
import type { Clock } from './clock';
import { isOfficeOutage } from './office-outage';
import { assertValidSchedule, nextCycleAt } from './schedule';
import { ServiceProbeTracker } from './tracker';
import type { ProbeSignal, TrackerOptions, TrackerState } from './tracker';
import type { CheckKind, CheckResult, ScheduleConfig, ServiceTarget } from './types';

export const DEFAULT_CONCURRENCY = 16;

export interface RunnerOptions {
  services: ServiceTarget[];
  schedule: ScheduleConfig;
  /** Máximo de pruebas en vuelo (servicios y referencias). Por defecto del sistema: 16. */
  concurrency: number;
  clock: Clock;
  check: CheckFn;
  tracker?: Partial<TrackerOptions>;
  /** Solo la oficina: 1.1.1.1 y 8.8.8.8 (ICMP o TCP 443/53, a elección del constructor). */
  references?: ServiceTarget[];
  onResult(result: CheckResult, signals: ProbeSignal[]): void;
}

interface Job {
  kind: CheckKind;
  cycleAt: Date;
  /** Instante en que la prueba debía empezar: prioridad en la cola global. */
  dueAt: number;
  orderId: number | null;
  seq: number;
}

interface Owner {
  target: ServiceTarget;
  /** Pruebas pendientes de este dueño, ordenadas por (dueAt, seq). */
  queue: Job[];
  busy: boolean;
}

interface ServiceState extends Owner {
  tracker: ServiceProbeTracker;
  /** Instante (ms) del reintento ya programado, para no duplicarlo. */
  retryFor: number | null;
  /** Franja regular omitida por un reintento pendiente que aún no la ha cubierto. */
  substituteCycleAt: Date | null;
}

type TimedEvent =
  | { at: number; seq: number; type: 'REGULAR'; svc: ServiceState; cycleAt: Date }
  | { at: number; seq: number; type: 'RETRY'; svc: ServiceState }
  | { at: number; seq: number; type: 'SLOT' };

interface Slot {
  start: number;
  end: number;
  /** Servicios activos al abrir la franja: de ellos se espera un resultado. */
  expected: Set<number>;
  refsOk: Map<number, boolean>;
  servicesOk: Map<number, boolean>;
}

/** Montículo binario mínimo por (at, seq): la cola de prioridad por instante. */
class EventHeap {
  private readonly a: TimedEvent[] = [];
  get size(): number {
    return this.a.length;
  }
  peek(): TimedEvent | undefined {
    return this.a[0];
  }
  clear(): void {
    this.a.length = 0;
  }
  push(e: TimedEvent): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!EventHeap.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): TimedEvent | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && EventHeap.less(a[l], a[m])) m = l;
        if (r < a.length && EventHeap.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  private static less(x: TimedEvent, y: TimedEvent): boolean {
    return x.at < y.at || (x.at === y.at && x.seq < y.seq);
  }
}

/**
 * Ejecutor de la sonda.
 *
 * Diseño:
 * - Planificación: un montículo de eventos por instante (franja REGULAR de cada servicio,
 *   RETRY pedido por su tracker y SLOT de oficina) y un único temporizador armado al
 *   evento más próximo. Al vencer, el evento no lanza la prueba: la encola en su dueño.
 * - Ejecución: cada dueño (servicio o referencia) tiene su cola y como máximo una prueba
 *   en vuelo. Un semáforo global limita a `concurrency` las pruebas en vuelo (referencias
 *   incluidas); cuando hay hueco se arranca, entre los dueños libres, la prueba pendiente
 *   con menor `dueAt`. Así `runNow` sobre un servicio ocupado espera detrás de la prueba
 *   en curso, nunca en paralelo.
 * - Reintentos: tras cada resultado se consulta `tracker.pendingRetryAt()` y se programa
 *   el reintento (siempre se entregan los dos). Mientras el tracker tiene un reintento
 *   pendiente, la franja regular que vence se omite (el tracker ignoraría la regular en
 *   VERIFYING) y el siguiente reintento hereda su `cycleAt`: así un reintento que coincide
 *   con la franja siguiente la sustituye, queda como RETRY y la franja no se pierde. Si ya
 *   no queda reintento que la cubra (p. ej. el último estaba en vuelo), se lanza una
 *   REGULAR tardía con ese `cycleAt`.
 * - Si el proceso se retrasa más de un intervalo (suspensión), se salta a la próxima franja
 *   en lugar de lanzar en ráfaga las atrasadas.
 * - Caída de oficina (solo con `references`): en cada franja regular de la banda (límite
 *   alineado a Lima, desfase 0) se prueban las referencias; los resultados REGULAR/RETRY de
 *   los servicios activos al abrirse la franja con `cycleAt` en [inicio, fin) cuentan como
 *   los de esa franja (el primero de cada servicio). La franja se evalúa con
 *   `isOfficeOutage` en cuanto están todos sus resultados, en orden de franjas; si al abrir
 *   una franja sigue pendiente alguna que terminó antes de la anterior, se evalúa forzada
 *   con lo que haya (si faltan referencias se descarta sin cambiar el estado). En cada
 *   transición se crea una señal OFFICE_OUTAGE_START/END (serviceId null, UUID propio,
 *   `at` = hora de la evaluación) y se entrega, al final de `signals`, en el `onResult`
 *   del siguiente resultado de servicio entregado — que es el que completa la franja si
 *   fue un servicio, o el primero posterior si la completó una referencia.
 *   El estado de caída empieza desconocido: la primera franja juzgada tras crear el runner
 *   emite siempre su señal (START si hay caída, END si no), para que la central cierre una
 *   caída que terminó con la sonda parada (la central trata ambas de forma idempotente).
 *   Las referencias no tienen tracker, no generan señales propias, no se entregan por
 *   `onResult` y no cuentan para la regla de una prueba por servicio.
 * - `updateServices`: altas se programan; bajas pierden tracker, colas, reintentos y el
 *   resultado de la prueba que tuvieran en vuelo; cambios se aplican al destino en sitio
 *   conservando el tracker (incluido el umbral de latencia).
 * - `stop()` cancela temporizadores y colas y descarta los resultados de pruebas en vuelo,
 *   pero esas pruebas siguen ocupando su servicio y su hueco de concurrencia hasta que
 *   terminan: un `start()` inmediato no las solapa ni excede el cupo. Lo mismo vale para un
 *   id dado de baja y vuelto a dar de alta con su prueba en vuelo (`busyIds`). Los trackers
 *   se conservan y `start()` reprograma sus reintentos pendientes.
 * - Arranque: cada tracker nuevo se sincroniza con la central (STATE_SYNC o su primera
 *   señal) y el estado de caída de oficina también (ver arriba); así un reinicio de la sonda
 *   o la sustitución del runner no deja estados ni caídas colgados en la central.
 * - Una excepción en `onResult` o en el procesamiento interno de un resultado se ignora para
 *   no detener la sonda; el recuento de pruebas en vuelo se libera antes.
 */
export class ProbeRunner {
  private readonly clock: Clock;
  private readonly services = new Map<number, ServiceState>();
  private readonly refs: Owner[];
  private readonly events = new EventHeap();
  private timer: unknown = null;
  private timerAt: number | null = null;
  private running = false;
  private epoch = 0;
  private inFlight = 0;
  /** Ids de servicio con prueba en vuelo, independiente de su ServiceState (bajas/altas). */
  private readonly busyIds = new Set<number>();
  private seq = 0;
  private slots: Slot[] = [];
  /** null = aún sin juzgar ninguna franja desde que se creó el runner. */
  private outage: boolean | null = null;
  private pendingOffice: ProbeSignal[] = [];

  constructor(private readonly opts: RunnerOptions) {
    assertValidSchedule(opts.schedule);
    if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
      throw new Error(`Concurrencia inválida (${opts.concurrency}): debe ser un entero mayor o igual a 1.`);
    }
    this.clock = opts.clock;
    for (const s of opts.services) this.services.set(s.id, this.newService(s));
    this.refs = (opts.references ?? []).map((r) => ({ target: { ...r }, queue: [], busy: false }));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.epoch++;
    const now = this.clock.now();
    for (const svc of this.services.values()) {
      this.pushEvent({ type: 'REGULAR', svc, cycleAt: nextCycleAt(svc.target.id, now, this.opts.schedule), at: 0, seq: 0 });
      this.syncRetry(svc);
    }
    if (this.refs.length > 0) {
      this.pushEvent({ type: 'SLOT', at: this.nextSlotStart(now.getTime()), seq: 0 });
    }
    this.arm();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.epoch++;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = null;
    this.events.clear();
    // inFlight, busy y busyIds NO se reinician: las pruebas en vuelo siguen corriendo y
    // los liberan al terminar, así un start() posterior no las solapa ni excede el cupo.
    for (const o of this.owners()) o.queue.length = 0;
    for (const svc of this.services.values()) {
      svc.retryFor = null;
      svc.substituteCycleAt = null;
    }
    this.slots = [];
    this.pendingOffice = [];
  }

  updateServices(services: ServiceTarget[]): void {
    const ids = new Set(services.map((s) => s.id));
    for (const id of [...this.services.keys()]) {
      if (ids.has(id)) continue;
      this.services.delete(id);
      for (const slot of this.slots) slot.expected.delete(id);
    }
    const now = this.clock.now();
    for (const s of services) {
      const existing = this.services.get(s.id);
      if (existing) {
        Object.assign(existing.target, s);
        continue;
      }
      const svc = this.newService(s);
      this.services.set(s.id, svc);
      if (this.running) {
        this.pushEvent({ type: 'REGULAR', svc, cycleAt: nextCycleAt(s.id, now, this.opts.schedule), at: 0, seq: 0 });
      }
    }
    if (!this.running) return;
    this.evaluateSlots();
    this.pump();
    this.arm();
  }

  runNow(serviceId: number, kind: 'MANUAL' | 'CROSS', orderId: number | null): void {
    const svc = this.services.get(serviceId);
    if (!svc || !this.running) return;
    const now = this.clock.now();
    this.enqueue(svc, kind, now, orderId);
    this.pump();
  }

  states(): Map<number, TrackerState> {
    return new Map([...this.services].map(([id, s]) => [id, s.tracker.state()]));
  }

  officeOutage(): boolean {
    return this.outage === true;
  }

  // --- planificación ---------------------------------------------------------

  private newService(s: ServiceTarget): ServiceState {
    const target = { ...s };
    return {
      target,
      tracker: new ServiceProbeTracker(target, this.opts.tracker),
      queue: [],
      busy: false,
      retryFor: null,
      substituteCycleAt: null,
    };
  }

  /** Límite de franja de la banda (desfase 0; serviceOffsetMs(0) === 0). */
  private nextSlotStart(after: number): number {
    return nextCycleAt(0, new Date(after), this.opts.schedule).getTime();
  }

  private pushEvent(e: TimedEvent): void {
    if (e.type === 'REGULAR') e.at = e.cycleAt.getTime();
    e.seq = ++this.seq;
    this.events.push(e);
    this.arm();
  }

  private arm(): void {
    if (!this.running) return;
    const top = this.events.peek();
    if (top && this.timer !== null && this.timerAt === top.at) return;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = null;
    if (!top) return;
    this.timerAt = top.at;
    this.timer = this.clock.setTimeout(() => this.fire(), Math.max(0, top.at - this.clock.now().getTime()));
  }

  private fire(): void {
    this.timer = null;
    this.timerAt = null;
    if (!this.running) return;
    const now = this.clock.now().getTime();
    for (let top = this.events.peek(); top && top.at <= now; top = this.events.peek()) {
      this.events.pop();
      this.handle(top, now);
    }
    this.pump();
    this.arm();
  }

  private handle(e: TimedEvent, now: number): void {
    if (e.type === 'SLOT') {
      this.openSlot(e.at);
      return;
    }
    const svc = e.svc;
    if (this.services.get(svc.target.id) !== svc) return; // servicio dado de baja
    if (e.type === 'RETRY') {
      if (svc.retryFor !== e.at) return; // reintento obsoleto
      const cycleAt = svc.substituteCycleAt ?? new Date(e.at);
      svc.substituteCycleAt = null;
      this.enqueue(svc, 'RETRY', cycleAt, null, e.at);
      return;
    }
    // REGULAR: programa la siguiente franja (saltando las perdidas por suspensión).
    const id = svc.target.id;
    let next = nextCycleAt(id, e.cycleAt, this.opts.schedule);
    if (next.getTime() < now) next = nextCycleAt(id, new Date(now - 1), this.opts.schedule);
    this.pushEvent({ type: 'REGULAR', svc, cycleAt: next, at: 0, seq: 0 });

    if (svc.tracker.pendingRetryAt() !== null) {
      // Hay reintento pendiente: la regular se omite y el reintento la sustituye.
      const queuedRetry = svc.queue.find((j) => j.kind === 'RETRY');
      if (queuedRetry) queuedRetry.cycleAt = e.cycleAt;
      else svc.substituteCycleAt = e.cycleAt;
      return;
    }
    this.enqueue(svc, 'REGULAR', e.cycleAt, null);
  }

  private syncRetry(svc: ServiceState): void {
    const pending = svc.tracker.pendingRetryAt();
    if (pending === null) {
      svc.retryFor = null;
      if (svc.substituteCycleAt !== null) {
        // Ningún reintento cubrirá la franja omitida: regular tardía.
        const cycleAt = svc.substituteCycleAt;
        svc.substituteCycleAt = null;
        this.enqueue(svc, 'REGULAR', cycleAt, null, this.clock.now().getTime());
      }
      return;
    }
    const at = pending.getTime();
    if (svc.retryFor === at) return;
    svc.retryFor = at;
    this.pushEvent({ type: 'RETRY', svc, at, seq: 0 });
  }

  // --- ejecución -------------------------------------------------------------

  private *owners(): Iterable<Owner> {
    yield* this.services.values();
    yield* this.refs;
  }

  private enqueue(owner: Owner, kind: CheckKind, cycleAt: Date, orderId: number | null, dueAt = cycleAt.getTime()): void {
    const job: Job = { kind, cycleAt, dueAt, orderId, seq: ++this.seq };
    const q = owner.queue;
    let i = q.length;
    while (i > 0 && q[i - 1].dueAt > job.dueAt) i--;
    q.splice(i, 0, job);
  }

  private pump(): void {
    while (this.running && this.inFlight < this.opts.concurrency) {
      let best: Owner | null = null;
      for (const o of this.owners()) {
        if (o.busy || o.queue.length === 0) continue;
        // Un id dado de baja y vuelto a dar de alta con su prueba aún en vuelo sigue ocupado.
        if (this.isService(o) && this.busyIds.has(o.target.id)) continue;
        const j = o.queue[0];
        const b = best?.queue[0];
        if (!b || j.dueAt < b.dueAt || (j.dueAt === b.dueAt && j.seq < b.seq)) best = o;
      }
      if (!best) return;
      this.launch(best);
    }
  }

  private launch(owner: Owner): void {
    const job = owner.queue.shift()!;
    const isRef = !this.isService(owner);
    const serviceId = owner.target.id;
    owner.busy = true;
    if (!isRef) this.busyIds.add(serviceId);
    this.inFlight++;
    const epoch = this.epoch;
    const startedAt = this.clock.now();
    let p: Promise<CheckResult>;
    try {
      p = Promise.resolve(
        this.opts.check({ ...owner.target }, job.kind, job.cycleAt, { orderId: job.orderId, now: () => this.clock.now() }),
      );
    } catch (err) {
      p = Promise.reject(err);
    }
    p.catch((): CheckResult => this.failure(owner.target, job, startedAt))
      .then((r) => {
        // Liberar siempre, aunque la ejecución se haya detenido o el servicio dado de baja.
        this.inFlight--;
        owner.busy = false;
        if (!isRef) this.busyIds.delete(serviceId);
        try {
          if (epoch !== this.epoch) return; // detenido mientras estaba en vuelo: se descarta
          if (isRef) this.onReferenceResult(owner, r);
          else this.onServiceResult(owner as ServiceState, r);
        } finally {
          if (this.running) {
            this.pump();
            this.arm();
          }
        }
      })
      .catch(() => {
        // Un error interno no debe convertirse en un rechazo no gestionado que tumbe la
        // sonda 24/7; el recuento ya quedó liberado arriba.
      });
  }

  private isService(o: Owner): o is ServiceState {
    return 'tracker' in o;
  }

  /** `check` nunca debería lanzar; si lo hace se registra como fallo de red. */
  private failure(target: ServiceTarget, job: Job, startedAt: Date): CheckResult {
    return {
      id: randomUUID(),
      serviceId: target.id,
      kind: job.kind,
      cycleAt: job.cycleAt.toISOString(),
      startedAt: startedAt.toISOString(),
      durationMs: Math.max(0, this.clock.now().getTime() - startedAt.getTime()),
      ok: false,
      errorCode: 'NETWORK',
      httpStatus: null,
      orderId: job.orderId,
    };
  }

  private onServiceResult(svc: ServiceState, r: CheckResult): void {
    if (this.services.get(svc.target.id) !== svc) return; // dado de baja: se descarta
    const signals = svc.tracker.onResult(r);
    this.syncRetry(svc);
    this.recordSlotResult(svc.target.id, r);
    const out = [...signals, ...this.pendingOffice];
    this.pendingOffice = [];
    try {
      this.opts.onResult(r, out);
    } catch {
      // un fallo del consumidor no debe detener la sonda
    }
  }

  // --- caída de oficina ------------------------------------------------------

  private openSlot(start: number): void {
    const end = this.nextSlotStart(start);
    this.slots.push({ start, end, expected: new Set(this.services.keys()), refsOk: new Map(), servicesOk: new Map() });
    this.pushEvent({ type: 'SLOT', at: end, seq: 0 });
    const cycleAt = new Date(start);
    for (const ref of this.refs) this.enqueue(ref, 'REGULAR', cycleAt, null);
    this.evaluateSlots(start);
  }

  private findSlot(cycleAt: number): Slot | undefined {
    return this.slots.find((s) => s.start <= cycleAt && cycleAt < s.end);
  }

  private onReferenceResult(ref: Owner, r: CheckResult): void {
    const slot = this.findSlot(Date.parse(r.cycleAt));
    if (!slot) return;
    slot.refsOk.set(this.refs.indexOf(ref), r.ok);
    this.evaluateSlots();
  }

  private recordSlotResult(serviceId: number, r: CheckResult): void {
    if (this.refs.length === 0 || (r.kind !== 'REGULAR' && r.kind !== 'RETRY')) return;
    const slot = this.findSlot(Date.parse(r.cycleAt));
    if (!slot || !slot.expected.has(serviceId) || slot.servicesOk.has(serviceId)) return;
    slot.servicesOk.set(serviceId, r.ok);
    this.evaluateSlots();
  }

  /** Evalúa en orden las franjas completas; con `forceBefore`, también las que terminaron antes. */
  private evaluateSlots(forceBefore?: number): void {
    while (this.slots.length > 0) {
      const s = this.slots[0];
      const refsDone = s.refsOk.size === this.refs.length;
      const complete = refsDone && [...s.expected].every((id) => s.servicesOk.has(id));
      const forced = forceBefore !== undefined && s.end < forceBefore;
      if (!complete && !forced) return;
      this.slots.shift();
      if (!refsDone) continue; // sin todas las referencias no se puede juzgar
      const out = isOfficeOutage([...s.refsOk.values()], [...s.servicesOk.values()]);
      if (out === this.outage) continue;
      this.outage = out;
      this.pendingOffice.push({
        id: randomUUID(),
        type: out ? 'OFFICE_OUTAGE_START' : 'OFFICE_OUTAGE_END',
        serviceId: null,
        at: this.clock.now().toISOString(),
        firstFailureAt: null,
      });
    }
  }
}
