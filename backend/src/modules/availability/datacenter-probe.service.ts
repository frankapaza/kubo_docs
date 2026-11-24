import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AvailabilityIngestService } from './availability-ingest.service';
import { CheckResult, DEFAULT_SCHEDULE, ProbeRunner, ProbeSignal, RunnerOptions, runCheck, ServiceTarget, systemClock } from './core';
import { MonitorProbeOrder } from './entities/monitor-probe-order.entity';
import { MonitorProbe } from './entities/monitor-probe.entity';
import { MonitorService } from './entities/monitor-service.entity';

export const DATACENTER_PROBE_CODE = 'kubo-01';
const ORDERS_MS = 5000;
const RELOAD_MS = 60000;

const toTarget = (s: MonitorService): ServiceTarget => ({
  id: Number(s.id),
  protocol: s.protocol,
  target: s.target,
  port: s.port === null || s.port === undefined ? null : Number(s.port),
  latencyThresholdMs: Number(s.latencyThresholdMs),
});

/**
 * La sonda kubo-01 en proceso (solo el worker). Sus resultados entran por
 * `acceptBatch`, igual que los de la oficina por HTTP (así se crean sus
 * `monitor_probe_states`). Solo mide: el evaluador y la purga corren en el backend.
 * Las comprobaciones cruzadas le llegan como órdenes CROSS en `monitor_probe_orders`.
 */
@Injectable()
export class DatacenterProbeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DatacenterProbeService.name);
  private runner: ProbeRunner | null = null;
  private probe: MonitorProbe | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private pollingOrders = false;
  private reloading = false;
  /** Cola de entrega: los resultados llegan a acceptBatch en el orden en que se produjeron. */
  private ingestChain: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(MonitorProbe) private readonly probes: Repository<MonitorProbe>,
    @InjectRepository(MonitorService) private readonly services: Repository<MonitorService>,
    @InjectRepository(MonitorProbeOrder) private readonly orders: Repository<MonitorProbeOrder>,
    private readonly ingest: AvailabilityIngestService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const probe = await this.probes.findOneBy({ code: DATACENTER_PROBE_CODE });
    if (!probe) {
      throw new Error(`No existe la sonda '${DATACENTER_PROBE_CODE}' en monitor_probes: aplicar la migración 031.`);
    }
    this.probe = probe;
    const runner = this.createRunner({
      services: await this.loadTargets(),
      schedule: DEFAULT_SCHEDULE,
      concurrency: 16,
      clock: systemClock,
      check: runCheck,
      tracker: { trackDegradation: false },
      onResult: (r, signals) => this.onResult(r, signals),
    });
    this.runner = runner;
    runner.start();
    this.timers = [
      setInterval(() => void this.reload(), RELOAD_MS),
      setInterval(() => void this.pollOrders(), ORDERS_MS),
    ];
    this.logger.log(`Sonda ${DATACENTER_PROBE_CODE} iniciada`);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.runner?.stop();
    await this.ingestChain;
  }

  protected createRunner(opts: RunnerOptions): ProbeRunner {
    return new ProbeRunner(opts);
  }

  private async loadTargets(): Promise<ServiceTarget[]> {
    const rows = await this.services.find({ where: { status: 'ACTIVE' } });
    return rows.map(toTarget);
  }

  private onResult(r: CheckResult, signals: ProbeSignal[]): void {
    const probe = this.probe;
    if (!probe) return;
    this.ingestChain = this.ingestChain
      .then(() => this.ingest.acceptBatch(probe, { checks: [r], signals, version: 'worker' }, new Date()))
      .then(() => undefined)
      .catch((e) => this.logger.error(`No se pudo registrar el resultado del servicio ${r.serviceId}: ${(e as Error).message}`));
  }

  private async reload(): Promise<void> {
    if (this.reloading || !this.runner) return;
    this.reloading = true;
    try {
      this.runner.updateServices(await this.loadTargets());
    } catch (e) {
      this.logger.error(`No se pudo recargar el inventario: ${(e as Error).message}`);
    } finally {
      this.reloading = false;
    }
  }

  /** Cada orden MANUAL o CROSS pendiente se toma una sola vez (update condicional sobre taken_at IS NULL). */
  private async pollOrders(): Promise<void> {
    if (this.pollingOrders || !this.runner || !this.probe) return;
    this.pollingOrders = true;
    try {
      const pending = await this.orders.find({
        where: { probeId: Number(this.probe.id), kind: In(['MANUAL', 'CROSS']), takenAt: IsNull() },
        order: { id: 'ASC' },
      });
      for (const o of pending) {
        const res = await this.orders.update({ id: o.id, takenAt: IsNull() }, { takenAt: new Date() });
        if ((res.affected ?? 0) !== 1) continue; // otro proceso la tomó
        this.runner.runNow(Number(o.serviceId), o.kind, Number(o.id));
      }
    } catch (e) {
      this.logger.error(`No se pudieron tomar las órdenes de ${DATACENTER_PROBE_CODE}: ${(e as Error).message}`);
    } finally {
      this.pollingOrders = false;
    }
  }
}
