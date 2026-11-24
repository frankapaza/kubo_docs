import {
  DEFAULT_CONCURRENCY,
  ProbeRunner,
  type CheckFn,
  type CheckResult,
  type Clock,
  type ProbeSignal,
} from '@kubo/monitoring-core';
import { CentralHttpError, type CentralApi, type CombinedStateRow, type ProbeConfig, type ProbeView } from './central-client';
import type { EngineConfig } from './config';
import { splitItems, type Outbox, type OutboxItem } from './outbox';

export interface EngineStatus {
  engine: { version: string; startedAt: string };
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
 * fallido si falla el envío o el `sync`; tras 3 seguidos, `central.reachable` es false.
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
 * único persistente es la cola. Para que la central no se quede con un estado que ya no es
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
    const saved = this.outbox.loadConfig();
    if (saved) {
      try {
        this.applyConfig(saved.version, JSON.parse(saved.json) as ProbeConfig, false);
        this.log.info(`Configuración guardada ${saved.version} cargada (${this.runnerConfig?.services.length ?? 0} servicios).`);
      } catch (err) {
        this.log.error(`Configuración guardada inválida: ${errMsg(err)}`);
      }
    }
    const state = this.outbox.loadState();
    if (state) {
      try {
        this.lastState = JSON.parse(state) as CombinedStateRow[];
        this.lastStateJson = state;
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
    const reachable = this.consecutiveFailures < UNREACHABLE_AFTER_FAILURES;
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
      central: { reachable, lastSyncAt: this.lastSyncAt, consecutiveFailures: this.consecutiveFailures, rejecting: this.rejecting },
      officeOutage: this.runner?.officeOutage() ?? false,
      pending: this.outbox.pendingCount(),
      services,
    };
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
        onResult: (r, signals) => this.onResult(r, signals),
      });
      this.runner?.stop();
      this.runner = runner;
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

  private onResult(r: CheckResult, signals: ProbeSignal[]): void {
    // Primero a disco: es lo único que sobrevive a un reinicio del servicio.
    this.outbox.enqueueResult(r, signals);
    const prev = this.local.get(r.serviceId);
    this.local.set(r.serviceId, {
      lastCheckAt: r.startedAt,
      lastLatencyMs: r.ok ? r.durationMs : (prev?.lastLatencyMs ?? null),
    });
    for (const s of signals) {
      this.log.info(`Señal ${s.type}${s.serviceId === null ? '' : ` servicio ${s.serviceId}`} (${s.at}).`);
    }
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
