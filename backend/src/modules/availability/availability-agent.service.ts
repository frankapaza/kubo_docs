import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { estimateDaysToFull } from './domain/disk-trend';
import { AgentSampleDto, AgentSampleResponse } from './dto/agent.dto';
import { AgentDisk, AgentIisPool, AgentServiceStatus, MonitorAgentSample } from './entities/monitor-agent-sample.entity';
import { MonitorServer } from './entities/monitor-server.entity';

/** Intervalo que la central le indica al agente. */
export const AGENT_INTERVAL_SECONDS = 60;

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const TREND_DAYS = 7;

export interface AgentDiskView extends AgentDisk {
  /** Porcentaje libre con 2 decimales; null si el total es 0. */
  freePct: number | null;
  /** Días estimados hasta llenarse (1 decimal); null si no baja o no hay datos. */
  daysToFull: number | null;
}

export interface AgentView {
  lastSampleAt: Date | null;
  agentVersion: string | null;
  cpuPct: number | null;
  ramPct: number | null;
  disks: AgentDiskView[];
  /** null si el servidor no tiene IIS (o aún no hay muestras). */
  iisPools: AgentIisPool[] | null;
  services: AgentServiceStatus[];
  eventErrors24h: number;
  series24h: Array<{ at: Date; cpuPct: number; ramPct: number }>;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Recibe las muestras del agente de servidor y arma la vista del personal. */
@Injectable()
export class AvailabilityAgentService {
  constructor(
    @InjectRepository(MonitorServer) private readonly servers: Repository<MonitorServer>,
    @InjectRepository(MonitorAgentSample) private readonly samples: Repository<MonitorAgentSample>,
  ) {}

  /**
   * Guarda la muestra con la hora de la central (`receivedAt`), no la del
   * agente, y marca el servidor como visto. Devuelve los servicios a vigilar.
   */
  async acceptSample(server: MonitorServer, dto: AgentSampleDto, receivedAt: Date): Promise<AgentSampleResponse> {
    const serverId = Number(server.id);
    await this.samples.insert({
      serverId,
      at: receivedAt,
      cpuPct: dto.cpuPct,
      ramPct: dto.ramPct,
      disks: dto.disks.map((d) => ({ name: d.name, totalBytes: d.totalBytes, freeBytes: d.freeBytes })),
      iis: { pools: dto.iisPools ? dto.iisPools.map((p) => ({ name: p.name, state: p.state })) : null },
      services: dto.services.map((s) => ({ name: s.name, status: s.status })),
      eventErrors: dto.eventErrors.system + dto.eventErrors.application,
      agentVersion: dto.agentVersion,
    });
    await this.servers.update(serverId, { agentLastSeenAt: receivedAt, agentVersion: dto.agentVersion });
    return { watchServices: server.agentWatchServices ?? [], intervalSeconds: AGENT_INTERVAL_SECONDS };
  }

  async agentView(serverId: number, now: Date): Promise<AgentView> {
    const server = await this.servers.findOne({ where: { id: serverId } });
    if (!server) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Servidor no encontrado' });

    const last = await this.samples.findOne({ where: { serverId }, order: { at: 'DESC' } });
    if (!last) {
      return {
        lastSampleAt: null,
        agentVersion: server.agentVersion,
        cpuPct: null,
        ramPct: null,
        disks: [],
        iisPools: null,
        services: [],
        eventErrors24h: 0,
        series24h: [],
      };
    }

    const week = await this.samples.find({
      where: { serverId, at: MoreThanOrEqual(new Date(now.getTime() - TREND_DAYS * DAY_MS)) },
      order: { at: 'ASC' },
      select: { id: true, at: true, cpuPct: true, ramPct: true, disks: true, eventErrors: true },
    });
    const dayFrom = now.getTime() - DAY_MS;
    const day = week.filter((s) => new Date(s.at).getTime() >= dayFrom);

    const disks = (last.disks ?? []).map((d): AgentDiskView => {
      const total = Number(d.totalBytes);
      const free = Number(d.freeBytes);
      const points = week.flatMap((s) =>
        (s.disks ?? []).filter((x) => x.name === d.name).map((x) => ({ at: new Date(s.at), freeBytes: Number(x.freeBytes) })),
      );
      const days = estimateDaysToFull(points);
      return {
        name: d.name,
        totalBytes: total,
        freeBytes: free,
        freePct: total > 0 ? round((free / total) * 100, 2) : null,
        daysToFull: days === null ? null : round(days, 1),
      };
    });

    return {
      lastSampleAt: new Date(last.at),
      agentVersion: last.agentVersion ?? server.agentVersion,
      cpuPct: Number(last.cpuPct),
      ramPct: Number(last.ramPct),
      disks,
      iisPools: last.iis?.pools ?? null,
      services: last.services ?? [],
      eventErrors24h: day.reduce((a, s) => a + Number(s.eventErrors), 0),
      series24h: day.map((s) => ({ at: new Date(s.at), cpuPct: Number(s.cpuPct), ramPct: Number(s.ramPct) })),
    };
  }
}

