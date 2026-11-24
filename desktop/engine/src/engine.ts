import {
  DEFAULT_CONCURRENCY,
  nextCycleAt,
  ProbeRunner,
  type CheckFn,
  type CheckResult,
  type Clock,
  type ProbeSignal,
} from '@kubo/monitoring-core';
import { CentralHttpError, type CentralApi, type CombinedStateRow, type ProbeConfig, type ProbeView } from './central-client';
import type { EngineConfig } from './config';
import { diffStates, type EngineEvent, type EngineEventDraft } from './events/diff-states';
import { splitItems, type Outbox, type OutboxItem } from './outbox';

export interface EngineStatus {
  engine: { version: string; startedAt: string };
  /** Origen de la central (sin barra final): el widget construye con él los enlaces a la web. */
  centralUrl: string;
  central: {
    reachable: boolean;
    lastSyncAt: string | null;
    consecutiveFailures: number;
    /** La central rechaza el contenido de los envíos (corte de dead_letter abierto). */
    rejecting: boolean;
  };
  officeOutage: boolean;
  pending: number;
  services: CombinedStateRow[];
}

export interface EngineLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface EngineOptions {
  config: EngineConfig;
  outbox: Outbox;
  central: CentralApi;
  clock: Clock;
  check: CheckFn;
  /** Versión que se informa en cada lote (≤ 40 caracteres). */
  version?: string;
  logger?: EngineLogger;
}

/** Topes del lote (DTO de la central). */
export const MAX_CHECKS_PER_BATCH = 500;
export const MAX_SIGNALS_PER_BATCH = 200;
/** Sondeos fallidos seguidos tras los que la central se da por caída. */
export const UNREACHABLE_AFTER_FAILURES = 3;
/**
 * Envíos de lote por sondeo (incluidos los de la bisección): con 15 s entre sondeos,
 * ≤ 40/min, por debajo del límite de 60/min de la central.
 */
export const MAX_BATCHES_PER_TICK = 10;
/** Respuestas que dependen del contenido del lote: se parte el lote en lugar de reintentarlo igual. */
const CONTENT_REJECTED = new Set([400, 413]);
/** Descartes seguidos (sin envío aceptado en medio) que abren el corte. */
export const DEAD_LETTER_BREAKER = 3;
/**
 * Margen para decidir el aviso de «la central no responde» si no llega el veredicto de oficina:
 * tras el fin de la primera franja que puede juzgar el fallo (y nunca antes de este tiempo desde el umbral).
 */
export const UNREACHABLE_VERDICT_GRACE_MS = 2 * 60_000;
/** Clave de la tabla `kv` con las marcas del diario (sobreviven a un reinicio). */
export const JOURNAL_FLAGS_KEY = 'journal';

/** «La central no responde» alcanzado, a la espera del veredicto de oficina para decidir si avisa. */
interface UnreachablePending {
  /** ms del primer sondeo fallido de la racha: solo decide una franja que empiece en o después. */
  since: number;
  /** ms: si no llega veredicto, se anota con aviso. */
  deadline: number;
  /** Algún veredicto (de una franja válida) dijo caída de oficina. */
  sawOutage: boolean;
}

interface JournalFlags {
  outageJournaled: boolean;
  unreachableJournaled: boolean;
  unreachableSilent: boolean;
  pending: UnreachablePending | null;
}

const silent: EngineLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

interface LocalView {
  lastCheckAt: string;
  lastLatencyMs: number | null;
}

/**
 * Motor de la oficina: mide con un `ProbeRunner`, guarda cada resultado y sus
 * señales en el `Outbox` en cuanto llega y, cada `syncIntervalMs`:
 * 1. envía la cola en lotes (prefijos en orden de inserción) mientras la central responda;
 * 2. `sync`: aplica la configuración nueva (y la guarda), ejecuta las órdenes y
 *    guarda el estado combinado para el widget.
 * El `sync` se hace SIEMPRE, aunque el envío falle: la configuración, las órdenes, el
 * estado y el `last_seen_at` no dependen de que la cola avance. Un sondeo cuenta como
 * fallido si falla el envío o el `sync`; tras 3 seguidos con fallos reales de red/sync,
 * `central.reachable` es false (los del corte de rechazo cuentan en `consecutiveFailures`,
 * pero no en `reachable`: la central responde, solo rechaza).
 * Un 429 no cuenta como fallo: se respeta `Retry-After` antes de volver a enviar.
 * Un 400/413 (el contenido del lote) parte el lote por la mitad, siempre como prefijo
 * ordenado, hasta que la central lo acepte; un único elemento rechazado va a
 * `dead_letter` y sale de la cola, para no bloquear todo lo posterior.
 *
 * Las pruebas de un mismo destino nunca se solapan, tampoco entre el runner viejo y el
 * nuevo cuando se sustituye (cambio de horario o referencias): la prueba del nuevo
 * espera a que termine la que el viejo tuviera en vuelo.
 *
 * Nada del estado del `ProbeRunner` sobrevive a un reinicio: al arrancar se crea uno
 * nuevo con la configuración guardada (trackers en OK, caída de oficina desconocida). Lo
 * persistente es la cola, el último estado combinado y las marcas del diario (caída de oficina
 * y «no responde» anotados, y el aviso pendiente) en `kv`, para no repetir avisos tras un
 * reinicio. Para que la central no se quede con un estado que ya no es
 * cierto, el runner nuevo (también al sustituirlo por cambio de horario o referencias) se
 * resincroniza: STATE_SYNC por servicio sano y la señal de caída de la primera franja.
 */
export class Engine {
  private readonly config: EngineConfig;
  private readonly outbox: Outbox;
  private readonly central: CentralApi;
  private readonly clock: Clock;
  private readonly check: CheckFn;
  private readonly version: string;
  private readonly log: EngineLogger;

  private runner: ProbeRunner | null = null;
  private runnerConfig: ProbeConfig | null = null;
  private configVersion: string | null = null;
  private running = false;
  private generation = 0;
  private timer: unknown = null;
  private startedAt: string | null = null;
  private lastSyncAt: string | null = null;
  private consecutiveFailures = 0;
  private sendNotBefore = 0;
  /** Tope del próximo envío mientras se biseca (se conserva entre sondeos). */
  private bisectSize = Infinity;
  /** Descartes a dead_letter seguidos sin envío aceptado en medio. */
  private deadStreak = 0;
  /** Corte abierto: la central rechaza todo; no se descarta nada más. */
  private rejecting = false;
  private lastState: CombinedStateRow[] = [];
  private lastStateJson: string | null = null;
  /**
   * Último estado FRESCO (de un sync correcto, o el guardado de la ejecución anterior), contra
   * el que se derivan los eventos (decisión 2). Null solo si nunca hubo uno: entonces el
   * primer estado no genera eventos.
   */
  private freshState: CombinedStateRow[] | null = null;
  /** Caída de oficina según el diario (una entrada por transición, aunque el runner se sustituya). */
  private outageJournaled = false;
  /** El runner actual ya declaró START o END (tiene veredicto propio sobre la caída de oficina). */
  private runnerHasOutageVerdict = false;
  /** CENTRAL_UNREACHABLE anotado (por fallos reales de red/sync); se cierra con CENTRAL_BACK. */
  private unreachableJournaled = false;
  /** El CENTRAL_UNREACHABLE anotado fue sin aviso (durante una caída de oficina). */
  private unreachableSilent = false;
  /** Umbral alcanzado, aviso aún sin decidir (ver `poll`). */
  private unreachablePending: UnreachablePending | null = null;
  /** Sondeos seguidos con fallos reales de red/sync (sin contar los del corte de rechazo). */
  private realFailures = 0;
  /** ms del primer sondeo de la racha actual de fallos reales. */
  private failureSince: number | null = null;
  private lastFlagsJson: string | null = null;
  private readonly local = new Map<number, LocalView>();
  /** Última prueba lanzada por id de destino (de cualquier runner), para no solaparlas. */
  private readonly inFlight = new Map<number, Promise<unknown>>();

  constructor(opts: EngineOptions) {
    this.config = opts.config;
    this.outbox = opts.outbox;
    this.central = opts.central;
    this.clock = opts.clock;
    const check = opts.check;
    this.check = ((target, kind, cycleAt, opts2) => {
      const prev = this.inFlight.get(target.id);
      const run = () => check(target, kind, cycleAt, opts2);
      const p = prev ? prev.then(run, run) : run();
      const tail = p.catch(() => undefined);
      this.inFlight.set(target.id, tail);
      void tail.then(() => {
        if (this.inFlight.get(target.id) === tail) this.inFlight.delete(target.id);
      });
      return p;
    }) as CheckFn;
    this.version = (opts.version ?? 'dev').slice(0, 40);
    this.log = opts.logger ?? silent;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.startedAt = this.clock.now().toISOString();
    this.loadFlags();
    const saved = this.outbox.loadConfig();
    if (saved) {
      try {
        this.applyConfig(saved.version, JSON.parse(saved.json) as ProbeConfig, false);
        this.log.info(`Configuración guardada ${saved.version} cargada (${this.runnerConfig?.services.length ?? 0} servicios).`);
      } catch (err) {
        this.log.error(`Configuración guardada inválida: ${errMsg(err)}`);
      }
    }
    // El plazo guardado es absoluto y pudo pasar con el motor parado: el runner nuevo necesita su
    // propia franja para dar veredicto, así que el plazo se recalcula desde ahora (`since` se conserva).
    if (this.unreachablePending && this.runnerConfig) {
      this.unreachablePending.deadline = this.verdictDeadline(this.clock.now().getTime(), this.runnerConfig);
      this.saveFlags();
    }
    const state = this.outbox.loadState();
    if (state) {
      try {
        this.lastState = JSON.parse(state) as CombinedStateRow[];
        this.lastStateJson = state;
        // Lo guardado es siempre un estado fresco (`res.state`, nunca el superpuesto): el primer
        // sync tras reiniciar anota lo que cambió mientras el motor estaba parado.
        this.freshState = this.lastState;
      } catch {
        this.log.warn('Estado combinado guardado ilegible: se ignora.');
      }
    }
    // Tras stop(): el runner se conserva (trackers y pruebas en vuelo) y se reanuda.
    this.runner?.start();
    this.schedule(0);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation++;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.runner?.stop();
  }

  status(): EngineStatus {
    // Solo los fallos reales de red/sync: con el corte de rechazo abierto el sync responde.
    const reachable = this.realFailures < UNREACHABLE_AFTER_FAILURES;
    const states = this.runner?.states();
    const services = reachable
      ? this.lastState
      : this.lastState.map((row) => {
          const st = states?.get(row.serviceId);
          if (st === undefined) return row;
          const loc = this.local.get(row.serviceId);
          const office: ProbeView = {
            state: st,
            lastCheckAt: loc?.lastCheckAt ?? row.office?.lastCheckAt ?? null,
            lastLatencyMs: loc?.lastLatencyMs ?? row.office?.lastLatencyMs ?? null,
          };
          return { ...row, office };
        });
    return {
      engine: { version: this.version, startedAt: this.startedAt ?? this.clock.now().toISOString() },
      centralUrl: this.config.centralUrl,
      central: { reachable, lastSyncAt: this.lastSyncAt, consecutiveFailures: this.consecutiveFailures, rejecting: this.rejecting },
      // Un runner recién sustituido aún no sabe nada de la caída: hasta su veredicto, manda el diario.
      officeOutage: this.runner && this.runnerHasOutageVerdict ? this.runner.officeOutage() : this.outageJournaled,
      pending: this.outbox.pendingCount(),
      services,
    };
  }

  /** Eventos del diario con id > `afterId` (como mucho `limit`) y el último id emitido. */
  events(afterId: number, limit: number): { lastId: number; events: EngineEvent[] } {
    return { lastId: this.outbox.events.lastId(), events: this.outbox.events.after(afterId, limit) };
  }

  /** Anota un evento en el diario con la hora de la PC. Un fallo del diario no detiene el motor. */
  private journal(e: EngineEventDraft): void {
    try {
      this.outbox.events.append({ ...e, at: this.clock.now().toISOString() });
    } catch (err) {
      this.log.error(`No se pudo anotar el evento ${e.kind} en el diario: ${errMsg(err)}`);
    }
  }

  private journalEngine(kind: EngineEvent['kind'], notify: boolean): void {
    this.journal({
      kind,
      incidentKey: null,
      incidentKind: null,
      serverName: null,
      serviceNames: [],
      criticality: null,
      ticketCode: null,
      notify,
    });
  }

  // --- un corte, un aviso ----------------------------------------------------
  //
  // Un corte de internet de la oficina también deja sin central: el motor alcanzaría el umbral
  // de «no responde» (~45 s) antes de que el runner juzgue la caída de oficina (5–10 min de día).
  // Para que el corte dé un solo aviso (OFFICE_OUTAGE_STARTED), CENTRAL_UNREACHABLE no se anota
  // al alcanzar el umbral: queda pendiente hasta el veredicto de la primera franja que empiece en
  // o después del primer sondeo fallido (las anteriores se midieron con internet).
  // - caída de oficina (ya anotada, o anotada al llegar su START) → se anota sin aviso;
  // - sin caída → se anota con aviso;
  // - la central vuelve antes → no se anota nada;
  // - sin referencias no hay veredicto posible → se decide al momento, con aviso;
  // - sin veredicto a tiempo → con aviso (`UNREACHABLE_VERDICT_GRACE_MS` tras el fin de esa franja).
  // Si la caída de oficina termina y la central sigue sin responder, ahora sí es la central: se
  // vuelve a dejar pendiente (desde ese momento) para avisar con el siguiente veredicto.

  private beginUnreachable(since: number): void {
    const cfg = this.runnerConfig;
    if (this.outageJournaled) {
      this.journalUnreachable(false);
    } else if (!cfg || cfg.references.length === 0) {
      this.journalUnreachable(true);
    } else {
      this.unreachablePending = { since, deadline: this.verdictDeadline(since, cfg), sawOutage: false };
      this.log.info('La central no responde: el aviso espera al veredicto de oficina (¿es internet de la oficina?).');
    }
  }

  private verdictDeadline(since: number, cfg: ProbeConfig): number {
    // La franja siguiente a `since` (la que la contiene puede no abrirse si el runner acaba de arrancar).
    const slotStart = nextCycleAt(0, new Date(since), cfg.schedule);
    const slotEnd = nextCycleAt(0, slotStart, cfg.schedule).getTime();
    return Math.max(this.clock.now().getTime(), slotEnd) + UNREACHABLE_VERDICT_GRACE_MS;
  }

  private journalUnreachable(notify: boolean): void {
    this.unreachablePending = null;
    this.unreachableJournaled = true;
    this.unreachableSilent = !notify;
    this.journalEngine('CENTRAL_UNREACHABLE', notify);
  }

  private onOfficeVerdict(v: { slotStart: Date; outage: boolean }, from: ProbeRunner): void {
    const p = this.unreachablePending;
    if (from !== this.runner || !p || v.slotStart.getTime() < p.since) return;
    if (!v.outage) this.journalUnreachable(true);
    else if (this.outageJournaled) this.journalUnreachable(false);
    else p.sawOutage = true; // su START llega con el siguiente resultado y lo decide (onResult)
    this.saveFlags();
  }

  private loadFlags(): void {
    const raw = this.outbox.loadKv(JOURNAL_FLAGS_KEY);
    if (raw === null) return;
    try {
      const f = JSON.parse(raw) as Partial<JournalFlags>;
      this.outageJournaled = f.outageJournaled === true;
      this.unreachableJournaled = f.unreachableJournaled === true;
      this.unreachableSilent = f.unreachableSilent === true;
      const p = f.pending;
      this.unreachablePending =
        p && Number.isFinite(p.since) && Number.isFinite(p.deadline) ? { since: p.since, deadline: p.deadline, sawOutage: p.sawOutage === true } : null;
      this.lastFlagsJson = raw;
    } catch {
      this.log.warn('Marcas del diario guardadas ilegibles: se ignoran.');
    }
  }

  /** Guarda las marcas del diario si cambiaron: un reinicio no repite avisos ni pierde el pendiente. */
  private saveFlags(): void {
    const flags: JournalFlags = {
      outageJournaled: this.outageJournaled,
      unreachableJournaled: this.unreachableJournaled,
      unreachableSilent: this.unreachableSilent,
      pending: this.unreachablePending ? { ...this.unreachablePending } : null,
    };
    const json = JSON.stringify(flags);
    if (json === this.lastFlagsJson) return;
    try {
      this.outbox.saveKv(JOURNAL_FLAGS_KEY, json);
      this.lastFlagsJson = json;
    } catch (err) {
      this.log.error(`No se pudieron guardar las marcas del diario: ${errMsg(err)}`);
    }
  }

  // --- sondeo ----------------------------------------------------------------

  private schedule(ms: number): void {
    if (!this.running) return;
    const gen = this.generation;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.tick(gen);
    }, ms);
  }

  private async tick(gen: number): Promise<void> {
    try {
      await this.poll(gen);
    } catch (err) {
      this.log.error(`Error inesperado en el sondeo: ${errMsg(err)}`);
    } finally {
      if (gen === this.generation) this.schedule(this.config.syncIntervalMs);
    }
  }

  private async poll(gen: number): Promise<void> {
    const errors: string[] = [];
    let rejected = false;
    try {
      await this.flush(gen);
    } catch (err) {
      // El corte ya dejó su línea ERROR en este sondeo: cuenta como fallo, sin repetir el aviso.
      if (err instanceof RejectingError) rejected = true;
      else errors.push(`envío: ${errMsg(err)}`);
    }
    if (gen !== this.generation) return;
    try {
      const res = await this.central.sync(this.configVersion);
      if (gen !== this.generation) return;
      if (res.config) this.applyConfig(res.configVersion, res.config, true);
      for (const o of res.orders) {
        if (!this.runner || !this.runnerConfig?.services.some((s) => s.id === o.serviceId)) {
          this.log.warn(`Orden ${o.id} (${o.kind}) para el servicio ${o.serviceId}, que no está en la configuración: se ignora.`);
          continue;
        }
        this.runner.runNow(o.serviceId, o.kind, o.id);
      }
      // Solo contra el último estado fresco, nunca contra el superpuesto con el local (decisión 2).
      for (const e of diffStates(this.freshState, res.state)) this.journal(e);
      this.freshState = res.state;
      this.lastState = res.state;
      const stateJson = JSON.stringify(res.state);
      if (stateJson !== this.lastStateJson) {
        this.outbox.saveState(stateJson);
        this.lastStateJson = stateJson;
      }
      this.lastSyncAt = this.clock.now().toISOString();
    } catch (err) {
      if (gen !== this.generation) return;
      errors.push(`sync: ${errMsg(err)}`);
    }

    // Diario: «no responde» solo tras 3 sondeos seguidos con fallos reales de red/sync; los
    // sondeos del corte de rechazo no cuentan (ese ya tiene su CENTRAL_REJECTING y el sync responde).
    const now = this.clock.now().getTime();
    if (errors.length === 0) {
      this.realFailures = 0;
      this.failureSince = null;
      if (this.unreachablePending) {
        this.unreachablePending = null;
        this.log.info('La central volvió a responder antes de decidir el aviso: no se anota.');
      }
      if (this.unreachableJournaled) {
        this.unreachableJournaled = false;
        this.unreachableSilent = false;
        this.journalEngine('CENTRAL_BACK', false);
      }
    } else {
      if (this.realFailures === 0) this.failureSince = now;
      this.realFailures++;
      const p = this.unreachablePending;
      if (p) {
        if (now >= p.deadline) {
          this.log.warn('Sin veredicto de oficina a tiempo: se anota que la central no responde.');
          this.journalUnreachable(!(p.sawOutage || this.outageJournaled));
        }
      } else if (this.realFailures >= UNREACHABLE_AFTER_FAILURES && !this.unreachableJournaled) {
        this.beginUnreachable(this.failureSince ?? now);
      }
    }
    this.saveFlags();
    if (errors.length === 0 && !rejected) {
      if (this.consecutiveFailures >= UNREACHABLE_AFTER_FAILURES) this.log.info('La central vuelve a responder.');
      this.consecutiveFailures = 0;
      return;
    }
    this.consecutiveFailures++;
    if (errors.length === 0) return; // solo el rechazo: ya registrado por flush()
    const n = this.consecutiveFailures;
    const msg = `Sondeo fallido (${n} seguidos): ${errors.join('; ')}`;
    if (n === UNREACHABLE_AFTER_FAILURES) this.log.error(`${msg} — la central no responde.`);
    // Durante una caída larga, un recordatorio cada ~10 min en lugar de una línea por sondeo.
    else if (n < UNREACHABLE_AFTER_FAILURES || n % 40 === 0) this.log.warn(msg);
  }

  /**
   * Envía la cola en lotes mientras quede algo y la central acepte. Lanza si la central
   * falla (red, 5xx, 401…). Con 400/413 parte el lote (prefijo de la mitad) y, si un
   * único elemento sigue rechazado, lo pasa a `dead_letter`.
   *
   * Corte: tras `DEAD_LETTER_BREAKER` descartes seguidos sin ningún envío aceptado en medio,
   * la central probablemente rechaza todo (p. ej. contrato roto tras un despliegue): se deja
   * de descartar, el resto queda en cola, `central.rejecting` pasa a true y el sondeo cuenta
   * como fallido. Con el corte abierto se prueba un solo elemento por sondeo; si se acepta,
   * se cierra y se sigue con normalidad.
   *
   * El tope de la bisección (`bisectSize`) se conserva entre envíos y sondeos mientras el
   * elemento problemático siga en cabeza; vuelve al lote completo tras un descarte (el
   * problemático ya salió) o cuando la cola queda vacía.
   */
  private async flush(gen: number): Promise<void> {
    for (let sends = 0; sends < MAX_BATCHES_PER_TICK; sends++) {
      if (this.clock.now().getTime() < this.sendNotBefore) return;
      const all = this.outbox.peekItems(MAX_CHECKS_PER_BATCH, MAX_SIGNALS_PER_BATCH);
      if (all.length === 0) {
        this.bisectSize = Infinity;
        return;
      }
      const size = this.rejecting ? 1 : this.bisectSize;
      const items: OutboxItem[] = all.slice(0, Math.min(all.length, size));
      const { checks, signals } = splitItems(items);
      try {
        const res = await this.central.sendBatch({ checks, signals, version: this.version });
        if (res.duplicateChecks > 0 || res.duplicateSignals > 0) {
          this.log.info(`Lote reenviado: ${res.duplicateChecks} checks y ${res.duplicateSignals} señales ya estaban en la central.`);
        }
      } catch (err) {
        if (err instanceof CentralHttpError && err.status === 429) {
          this.sendNotBefore = this.clock.now().getTime() + (err.retryAfterSec ?? 60) * 1000;
          this.log.warn(`La central limita el envío (429): reintento en ${err.retryAfterSec ?? 60} s.`);
          return;
        }
        if (err instanceof CentralHttpError && CONTENT_REJECTED.has(err.status)) {
          const reason = (err.body || err.message).slice(0, 200);
          if (this.rejecting) {
            this.log.error(`La central sigue rechazando los envíos (HTTP ${err.status}: ${reason}); ${all.length}+ elementos esperan en cola.`);
            throw new RejectingError(err.status);
          }
          if (items.length > 1) {
            this.bisectSize = Math.ceil(items.length / 2);
            this.log.warn(`La central rechaza un lote de ${items.length} (HTTP ${err.status}): se reintenta con ${this.bisectSize}.`);
            continue;
          }
          const bad = items[0];
          this.outbox.deadLetter(bad.kind, bad.item.id, err.status, err.body || err.message);
          this.deadStreak++;
          this.bisectSize = Infinity;
          this.log.error(
            `La central rechaza ${bad.kind === 'CHECK' ? 'el check' : 'la señal'} ${bad.item.id} (HTTP ${err.status}: ${reason}): pasa a dead_letter.`,
          );
          if (this.deadStreak >= DEAD_LETTER_BREAKER) {
            this.rejecting = true;
            this.journalEngine('CENTRAL_REJECTING', true);
            this.log.error(
              `${this.deadStreak} descartes seguidos: la central parece rechazar todo. Se dejan de descartar elementos; el resto queda en cola.`,
            );
            throw new RejectingError(err.status);
          }
          if (gen !== this.generation) return;
          continue;
        }
        throw err;
      }
      // Lo aceptado (nuevo o duplicado) ya está en la central: aunque se haya detenido el motor.
      this.outbox.ack(
        checks.map((c) => c.id),
        signals.map((s) => s.id),
      );
      this.deadStreak = 0;
      if (this.rejecting) {
        this.rejecting = false;
        this.log.info('La central vuelve a aceptar los envíos: se reanuda el envío normal.');
      }
      if (gen !== this.generation) return;
    }
  }

  // --- medición --------------------------------------------------------------

  private applyConfig(version: string, cfg: ProbeConfig, persist: boolean): void {
    const prev = this.runnerConfig;
    const sameShape =
      prev !== null &&
      JSON.stringify(prev.schedule) === JSON.stringify(cfg.schedule) &&
      JSON.stringify(prev.references) === JSON.stringify(cfg.references);

    if (this.runner && sameShape) {
      this.runner.updateServices(cfg.services);
    } else {
      // Primera configuración, o cambian horario/referencias: el runner no los cambia en sitio.
      const runner = new ProbeRunner({
        services: cfg.services,
        schedule: cfg.schedule,
        references: cfg.references,
        concurrency: DEFAULT_CONCURRENCY,
        clock: this.clock,
        check: this.check,
        onResult: (r, signals) => this.onResult(r, signals, runner),
        onOfficeVerdict: (v) => this.onOfficeVerdict(v, runner),
      });
      this.runner?.stop();
      this.runner = runner;
      this.runnerHasOutageVerdict = false;
      if (this.running) runner.start();
    }
    const ids = new Set(cfg.services.map((s) => s.id));
    for (const id of [...this.local.keys()]) if (!ids.has(id)) this.local.delete(id);
    this.runnerConfig = cfg;
    this.configVersion = version;
    if (persist) {
      this.outbox.saveConfig(version, JSON.stringify(cfg));
      this.log.info(`Configuración ${version} aplicada (${cfg.services.length} servicios).`);
    }
  }

  private onResult(r: CheckResult, signals: ProbeSignal[], from: ProbeRunner): void {
    // Primero a disco: es lo único que sobrevive a un reinicio del servicio.
    this.outbox.enqueueResult(r, signals);
    const prev = this.local.get(r.serviceId);
    this.local.set(r.serviceId, {
      lastCheckAt: r.startedAt,
      lastLatencyMs: r.ok ? r.durationMs : (prev?.lastLatencyMs ?? null),
    });
    for (const s of signals) {
      this.log.info(`Señal ${s.type}${s.serviceId === null ? '' : ` servicio ${s.serviceId}`} (${s.at}).`);
      if ((s.type === 'OFFICE_OUTAGE_START' || s.type === 'OFFICE_OUTAGE_END') && from === this.runner) {
        this.runnerHasOutageVerdict = true;
      }
      // Un runner nuevo repite START (o declara END sin caída previa): el diario anota solo transiciones.
      if (s.type === 'OFFICE_OUTAGE_START') {
        if (!this.outageJournaled) {
          this.outageJournaled = true;
          this.journalEngine('OFFICE_OUTAGE_STARTED', true);
        }
        // El corte ya avisa: «la central no responde» queda solo en el historial.
        if (this.unreachablePending) this.journalUnreachable(false);
      } else if (s.type === 'OFFICE_OUTAGE_END' && this.outageJournaled) {
        this.outageJournaled = false;
        // Un aviso por corte: el regreso queda solo en el historial.
        this.journalEngine('OFFICE_OUTAGE_ENDED', false);
        if (this.unreachableJournaled && this.unreachableSilent) {
          // Internet volvió y la central sigue sin responder: ahora sí es la central.
          const now = this.clock.now().getTime();
          const cfg = this.runnerConfig;
          if (cfg) this.unreachablePending = { since: now, deadline: this.verdictDeadline(now, cfg), sawOutage: false };
        }
      }
    }
    this.saveFlags();
  }
}

class RejectingError extends Error {
  constructor(readonly status: number) {
    super(`la central rechaza los envíos (HTTP ${status})`);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
