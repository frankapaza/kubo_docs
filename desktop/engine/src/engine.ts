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
import type { Outbox } from './outbox';

export interface EngineStatus {
  engine: { version: string; startedAt: string };
  central: { reachable: boolean; lastSyncAt: string | null; consecutiveFailures: number };
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
/** Lotes por sondeo: con 15 s entre sondeos, ≤ 40/min, por debajo del límite de 60/min. */
export const MAX_BATCHES_PER_TICK = 10;

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
 * Un sondeo falla si falla el envío o el `sync`; tras 3 seguidos, `central.reachable`
 * es false. Un 429 no cuenta como fallo: se respeta `Retry-After` antes de volver a enviar.
 *
 * Nada del estado del `ProbeRunner` sobrevive a un reinicio: al arrancar se crea uno
 * nuevo con la configuración guardada (trackers en OK). Lo único persistente es la cola.
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
  private lastState: CombinedStateRow[] = [];
  private lastStateJson: string | null = null;
  private readonly local = new Map<number, LocalView>();

  constructor(opts: EngineOptions) {
    this.config = opts.config;
    this.outbox = opts.outbox;
    this.central = opts.central;
    this.clock = opts.clock;
    this.check = opts.check;
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
      central: { reachable, lastSyncAt: this.lastSyncAt, consecutiveFailures: this.consecutiveFailures },
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
    try {
      await this.flush(gen);
      if (gen !== this.generation) return;
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
      if (this.consecutiveFailures >= UNREACHABLE_AFTER_FAILURES) this.log.info('La central vuelve a responder.');
      this.consecutiveFailures = 0;
    } catch (err) {
      if (gen !== this.generation) return;
      this.consecutiveFailures++;
      const msg = `Sondeo fallido (${this.consecutiveFailures} seguidos): ${errMsg(err)}`;
      const n = this.consecutiveFailures;
      if (n === UNREACHABLE_AFTER_FAILURES) this.log.error(`${msg} — la central no responde.`);
      // Durante una caída larga, un recordatorio cada ~10 min en lugar de una línea por sondeo.
      else if (n < UNREACHABLE_AFTER_FAILURES || n % 40 === 0) this.log.warn(msg);
    }
  }

  /** Envía la cola en lotes mientras quede algo y la central acepte. Lanza si la central falla. */
  private async flush(gen: number): Promise<void> {
    for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
      if (this.clock.now().getTime() < this.sendNotBefore) return;
      const { checks, signals } = this.outbox.peekBatch(MAX_CHECKS_PER_BATCH, MAX_SIGNALS_PER_BATCH);
      if (checks.length === 0 && signals.length === 0) return;
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
        throw err;
      }
      // Lo aceptado (nuevo o duplicado) ya está en la central: aunque se haya detenido el motor.
      this.outbox.ack(
        checks.map((c) => c.id),
        signals.map((s) => s.id),
      );
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

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
